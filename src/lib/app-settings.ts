/** 应用级设置读写（app_settings 表，key text pk / value jsonb）。key='llm' 存 {apiKey, model}；API key 只在服务端流转 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';

export interface LlmSettings {
  apiKey: string;
  model: string;
}

const LLM_SETTINGS_KEY = 'llm';

export async function getLlmSettings(): Promise<LlmSettings | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LLM_SETTINGS_KEY));
  if (!row) return null;
  const v = row.value as { apiKey?: unknown; model?: unknown };
  if (typeof v?.apiKey !== 'string' || !v.apiKey || typeof v?.model !== 'string' || !v.model) return null;
  return { apiKey: v.apiKey, model: v.model };
}

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: LLM_SETTINGS_KEY, value: s })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedAt: new Date() } });
}
