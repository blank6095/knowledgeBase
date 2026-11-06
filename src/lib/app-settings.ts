/** 应用级设置读写（app_settings 表，key text pk / value jsonb）。key='llm' 存 {apiKey, model, fastModel?}；API key 只在服务端流转 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decryptSecret, decryptSecretDetailed, encryptSecret } from '@/lib/secret-crypto';

export interface LlmSettings {
  apiKey: string;
  model: string;
  /** 可选：fast 档模型（摘要/测试连接等轻任务），留空 = 同 model */
  fastModel?: string;
}

const LLM_SETTINGS_KEY = 'llm';

export async function getLlmSettings(): Promise<LlmSettings | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LLM_SETTINGS_KEY));
  if (!row) return null;
  const v = row.value as { apiKey?: unknown; apiKeyEnc?: unknown; model?: unknown; fastModel?: unknown };
  let apiKey = '';
  if (typeof v?.apiKeyEnc === 'string' && v.apiKeyEnc) {
    apiKey = (await decryptSecret(v.apiKeyEnc)) ?? '';
  } else if (typeof v?.apiKey === 'string' && v.apiKey) {
    // 兼容旧明文行：首次读取时原地迁移，避免密钥长期以明文保留。
    apiKey = v.apiKey;
    const apiKeyEnc = await encryptSecret(apiKey).catch(() => null);
    if (apiKeyEnc) {
      await db
        .update(appSettings)
        .set({ value: { apiKeyEnc, model: v.model, fastModel: v.fastModel }, updatedAt: new Date() })
        .where(eq(appSettings.key, LLM_SETTINGS_KEY))
        .catch(() => {});
    }
  }
  if (!apiKey || typeof v?.model !== 'string' || !v.model) return null;
  const fastModel = typeof v?.fastModel === 'string' ? v.fastModel.trim() : '';
  return { apiKey, model: v.model, fastModel: fastModel || undefined };
}

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  const apiKeyEnc = await encryptSecret(s.apiKey);
  await db
    .insert(appSettings)
    .values({ key: LLM_SETTINGS_KEY, value: { apiKeyEnc, model: s.model, fastModel: s.fastModel } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { apiKeyEnc, model: s.model, fastModel: s.fastModel }, updatedAt: new Date() },
    });
}

/**
 * 已存 LLM Key 的可解密状态：
 * - unset：从未配置
 * - ok：能正常解密
 * - key-mismatch：已存密文但当前主密钥解不开
 *
 * 存在的意义：主密钥默认从登录口令派生（SETTINGS_ENCRYPTION_KEY 可选），
 * 用户改了口令后旧密文会静默失效，getLlmSettings() 一律返回 null，
 * 外部只能看到「未配置」，看不出真实原因是 Key 还在、只是解不开。
 * 这个状态让设置页能给出准确的处置提示，而不是让用户对着文档猜。
 */
export type LlmKeyState = 'unset' | 'ok' | 'key-mismatch';

export async function getLlmKeyState(): Promise<LlmKeyState> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LLM_SETTINGS_KEY));
    if (!row) return 'unset';
    const v = row.value as { apiKey?: unknown; apiKeyEnc?: unknown };
    if (typeof v?.apiKeyEnc === 'string' && v.apiKeyEnc) {
      const { outcome } = await decryptSecretDetailed(v.apiKeyEnc);
      // no-key / invalid 都归入 key-mismatch：处置动作相同——Key 还在库里，但需要重新填写
      return outcome === 'ok' || outcome === 'plaintext' ? 'ok' : 'key-mismatch';
    }
    // 旧明文行：读路径会原地迁移成密文，此处仍视为可用
    if (typeof v?.apiKey === 'string' && v.apiKey) return 'ok';
    return 'unset';
  } catch {
    // 诊断字段不允许影响主流程：探测失败按「未配置」处理
    return 'unset';
  }
}
