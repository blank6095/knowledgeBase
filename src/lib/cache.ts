/**
 * 高频读端点的统一服务端缓存（模块级 TTL，风格对齐 learner-profile.ts 的 cachedProfile 先例）。
 *
 * 边界：进程内缓存，仅在当前 Node 进程/热实例内有效；多实例或冷启动各自一份，
 * 属于 best-effort 优化，不承担一致性职责（所有写路径显式失效）。
 */

interface CacheEntry {
  /** 写入时间（ms epoch） */
  at: number;
  ttlMs: number;
  value: unknown;
}

/** 默认 TTL：与 learner-profile 的 60s 窗口一致 */
const DEFAULT_TTL_MS = 60_000;
/** 容量上限：超出后按插入顺序淘汰最旧条目 */
const MAX_ENTRIES = 64;
/**
 * 陈旧快照保留时长：新鲜缓存过期后仍保留更久，
 * 用于数据库瞬时不可用时的降级返回（宁可给 slightly old 的数据，也不要整页报错）。
 */
const STALE_TTL_MS = 15 * 60_000;

const store = new Map<string, CacheEntry>();
/** 上一次成功结果的快照（比新鲜缓存活得久，只在降级路径使用） */
const staleStore = new Map<string, CacheEntry>();

/** 读取缓存：过期条目立即删除并视为未命中 */
export function getCache<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= entry.ttlMs) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** 写入缓存：覆盖已有 key 不占新增容量，仅刷新写入时间与位置 */
export function setCache<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  const isNewKey = !store.has(key);
  if (isNewKey) {
    while (store.size >= MAX_ENTRIES) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  } else {
    // 重新插入以刷新 Map 顺序，避免刚更新的条目被当作最旧淘汰
    store.delete(key);
  }
  store.set(key, { at: Date.now(), ttlMs, value });

  // 同时留一份陈旧快照，供数据库不可用时降级返回
  staleStore.delete(key);
  staleStore.set(key, { at: Date.now(), ttlMs: STALE_TTL_MS, value });
  while (staleStore.size > MAX_ENTRIES) {
    const oldestKey = staleStore.keys().next().value;
    if (oldestKey === undefined) break;
    staleStore.delete(oldestKey);
  }
}

/**
 * 读取陈旧快照（降级用）：新鲜缓存已过期或不可用时仍可拿到上一次成功的结果。
 * 超过 STALE_TTL_MS 视为无快照。
 */
export function getStaleCache<T>(key: string): T | undefined {
  const entry = staleStore.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= entry.ttlMs) {
    staleStore.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** 失效：精确命中只删该 key；否则删除所有以该字符串为前缀的 key */
export function invalidateCache(prefixOrKey: string): void {
  const drop = (map: Map<string, CacheEntry>) => {
    if (map.delete(prefixOrKey)) return;
    for (const key of map.keys()) {
      if (key.startsWith(prefixOrKey)) map.delete(key);
    }
  };
  drop(store);
  drop(staleStore);
}

/** 测试钩子：清空全部缓存 */
export function clearAllCache(): void {
  store.clear();
  staleStore.clear();
}

/** 测试钩子：仅让新鲜缓存过期（保留陈旧快照），用于验证降级路径 */
export function expireFreshEntries(): void {
  store.clear();
}
