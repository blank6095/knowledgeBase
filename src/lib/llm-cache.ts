/**
 * LLM preview 输出缓存（llm_cache 表）：hash = sha256(kind|model|内容指纹)。
 * split 指纹为段 title+content；aggregate 为按 orderIndex 排序的各段 title+content 拼接。
 * ask 不缓存。上限 256 条，超限按 created_at 最旧删除。缓存内容不含敏感信息。
 */
import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { llmCache } from '@/db/schema';

const MAX_ENTRIES = 256;

/** 纯函数：kind|model|内容指纹 → sha256 key（同内容同 key、内容/模型变 key 变） */
export function cacheKey(kind: string, model: string, fingerprint: string): string {
  return createHash('sha256').update(`${kind}|${model}|${fingerprint}`).digest('hex');
}

export async function getCachedOutput<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ output: llmCache.output }).from(llmCache).where(eq(llmCache.hash, key));
  return row ? (row.output as T) : null;
}

export async function saveCachedOutput(key: string, kind: string, model: string, output: unknown): Promise<void> {
  await db.insert(llmCache).values({ hash: key, kind, output, model }).onConflictDoNothing();
  // 上限治理：超出 256 条时按最旧删除溢出部分
  await db.execute(sql`
    delete from llm_cache where hash in (
      select hash from llm_cache order by created_at asc, hash asc offset ${MAX_ENTRIES}
    )
  `);
}

/** 防御性读取：确认某 key 仍存在（供测试） */
export async function cacheHas(key: string): Promise<boolean> {
  const rows = await db.select({ hash: llmCache.hash }).from(llmCache).where(eq(llmCache.hash, key));
  return rows.length > 0;
}

/** 最旧优先（供测试观察上限治理） */
export async function cacheOldestKey(): Promise<string | null> {
  const [row] = await db.select({ hash: llmCache.hash }).from(llmCache).orderBy(asc(llmCache.createdAt), asc(llmCache.hash)).limit(1);
  return row?.hash ?? null;
}
