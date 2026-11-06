/**
 * TTL 缓存的公共底层：容量淘汰与写入顺序刷新。
 *
 * 为什么只抽这一段：
 * - 三个缓存（lib/cache.ts 的新鲜层与陈旧层、lib/segment-cache.ts 的段详情层）
 *   都各自实现了同一套「按容量上限淘汰最旧 + 覆盖已有 key 时刷新插入顺序」的逻辑；
 *   副本一旦漂移，就会出现「A 的缓存满了会误淘汰 B 的条目」这类难查的问题；
 * - 但三者的其余语义确实不同（新鲜/陈旧是否分 Map、失效是精确还是前缀、值是否可原地改写），
 *   把它们合并成一个「万能缓存」需要大量开关，复杂度反而超过重复本身——
 *   故只收敛真正重复且稳定的这段算法，其余各模块保持各自语义。
 */

/**
 * 写入一条缓存并维持容量上限。
 *
 * 规则（与三处原有实现逐条等价）：
 * - key 已存在：先删除再插入，刷新它在 Map 中的位置，避免刚更新的条目被当作最旧淘汰；
 * - key 不存在：先按容量上限淘汰最旧条目，再插入；
 * - 淘汰顺序为 Map 的插入顺序（最旧 = 第一个键）。
 *
 * @param store 目标 Map（原地修改）
 * @param key 缓存键
 * @param entry 条目内容（结构由调用方决定：新鲜层带 ttlMs，陈旧层带固定 TTL，段详情层不带）
 * @param maxEntries 容量上限；超出时淘汰最旧条目
 */
export function setWithCapacity<TEntry>(
  store: Map<string, TEntry>,
  key: string,
  entry: TEntry,
  maxEntries: number,
): void {
  if (store.has(key)) {
    // 重新插入以刷新 Map 顺序，避免刚更新的条目被当作最旧淘汰
    store.delete(key);
  } else {
    // 新键：先腾出容量再插入，保证不超过上限
    while (store.size >= maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }
  store.set(key, entry);
}
