/**
 * 读路径的统一降级包装：查询成功即写缓存；失败则回退到「上一次成功结果」的陈旧快照。
 *
 * 与 db-retry 的分工：
 * - db-retry：同一次请求内的瞬时故障重试（透明，用户无感）；
 * - 本模块：重试仍失败时不让页面 500（用 slightly old 的数据顶上，并在响应头标注 STALE）。
 */
import { getStaleCache, setCache } from '@/lib/cache';
import { describeDbError } from '@/lib/db-retry';

export interface StaleFallbackResult<T> {
  value: T;
  /** true 表示这次返回的是陈旧快照（数据库当前不可用） */
  stale: boolean;
}

export async function withStaleFallback<T>({
  cacheKey,
  ttlMs,
  run,
  label,
}: {
  cacheKey: string;
  /** 新鲜缓存 TTL（毫秒） */
  ttlMs: number;
  /** 真正的查询逻辑（内部可再套 withDbRetry） */
  run: () => Promise<T>;
  /** 日志标签 */
  label: string;
}): Promise<StaleFallbackResult<T>> {
  try {
    const value = await run();
    // 空结果不缓存（对应「资源不存在」语义，避免把 404 缓存成正常响应）
    if (value !== null && value !== undefined) setCache(cacheKey, value, ttlMs);
    return { value, stale: false };
  } catch (error) {
    const stale = getStaleCache<T>(cacheKey);
    if (stale !== undefined) {
      console.warn(`[db-fallback] ${label} 数据库不可用，返回陈旧快照（${describeDbError(error)}）`);
      return { value: stale, stale: true };
    }
    throw error;
  }
}
