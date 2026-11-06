/**
 * 图谱详情缓存（UX-30）。
 *
 * 详情面板按节点缓存 `/api/segments/[id]` 的响应，避免同一会话反复请求；
 * 但缓存必须能被失效，否则「编辑段 → 回图谱 → 再点该节点」会一直看到旧标题/摘要。
 *
 * 失效有两条轴：
 * 1. 显式失效：`invalidate(id)` / `invalidateAll()`，由编辑、复习、删除等写操作触发；
 * 2. 时间兜底：条目超过 `ttlMs` 后 `get()` 自动视为未命中并清除（其他标签页/其他入口
 *    改了数据时，当前页没有写回调也能自愈）。
 *
 * 纯逻辑：不依赖 React/DOM；时钟可注入，单测无需 fake timer。
 */

/** 默认有效期：5 分钟。会话内足够覆盖来回点选，又不会让数据长期陈旧。 */
export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

export interface DetailCache<T> {
  /** 命中且未过期时返回值；过期条目顺手删除并返回 undefined。 */
  get(id: string): T | undefined;
  /** 写入/覆盖并刷新时间戳。 */
  set(id: string, value: T): void;
  /** 是否存在未过期条目。 */
  has(id: string): boolean;
  /** 删除指定条目；命中返回 true（可重复调用，天然幂等）。 */
  invalidate(id: string): boolean;
  /** 全量失效（如整批数据同步后）。 */
  invalidateAll(): void;
  /** 当前未过期条目数。 */
  readonly size: number;
}

export interface DetailCacheOptions {
  /** 有效期（毫秒）；<= 0 表示永不过期。默认 {@link DETAIL_CACHE_TTL_MS}。 */
  ttlMs?: number;
  /** 时钟（测试注入用），默认 Date.now。 */
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export function createDetailCache<T>(options: DetailCacheOptions = {}): DetailCache<T> {
  const ttlMs = options.ttlMs ?? DETAIL_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry<T>>();

  const isFresh = (entry: CacheEntry<T>, at: number): boolean => ttlMs <= 0 || at - entry.storedAt < ttlMs;

  const read = (id: string): CacheEntry<T> | undefined => {
    const entry = entries.get(id);
    if (!entry) return undefined;
    if (isFresh(entry, now())) return entry;
    entries.delete(id);
    return undefined;
  };

  const prune = (): void => {
    const at = now();
    for (const [id, entry] of entries) {
      if (!isFresh(entry, at)) entries.delete(id);
    }
  };

  return {
    get(id) {
      return read(id)?.value;
    },
    set(id, value) {
      entries.set(id, { value, storedAt: now() });
    },
    has(id) {
      return read(id) !== undefined;
    },
    invalidate(id) {
      return entries.delete(id);
    },
    invalidateAll() {
      entries.clear();
    },
    get size() {
      prune();
      return entries.size;
    },
  };
}
