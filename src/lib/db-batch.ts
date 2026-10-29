import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '@/db';

export type PgBatchItem = BatchItem<'pg'>;

/** Neon HTTP batch 在单个事务中顺序执行；空数组无需发起请求。 */
export async function runBatch(queries: PgBatchItem[]): Promise<unknown[]> {
  if (queries.length === 0) return [];
  return db.batch(queries as [PgBatchItem, ...PgBatchItem[]]);
}
