/** 应用级设置读写（app_settings 表，key text pk / value jsonb）。key='llm' 存 {apiKey, model, fastModel?}；API key 只在服务端流转 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';

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
  const v = row.value as { apiKey?: unknown; model?: unknown; fastModel?: unknown };
  if (typeof v?.apiKey !== 'string' || !v.apiKey || typeof v?.model !== 'string' || !v.model) return null;
  const fastModel = typeof v?.fastModel === 'string' ? v.fastModel.trim() : '';
  return { apiKey: v.apiKey, model: v.model, fastModel: fastModel || undefined };
}

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: LLM_SETTINGS_KEY, value: s })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedAt: new Date() } });
}
