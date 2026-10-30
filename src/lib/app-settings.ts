/** 应用级设置读写（app_settings 表，key text pk / value jsonb）。key='llm' 存 {apiKey, model, fastModel?}；API key 只在服务端流转 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/secret-crypto';

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
