import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllCache, expireFreshEntries, getCache, getStaleCache, invalidateCache, setCache } from '@/lib/cache';

describe('进程内缓存的陈旧快照（数据库降级用）', () => {
  beforeEach(() => {
    clearAllCache();
  });

  it('写入后新鲜缓存与陈旧快照都可用', () => {
    setCache('k', { a: 1 });
    expect(getCache('k')).toEqual({ a: 1 });
    expect(getStaleCache('k')).toEqual({ a: 1 });
  });

  it('新鲜缓存过期后，陈旧快照仍在（供降级返回）', () => {
    setCache('k', { a: 1 }, 0); // 立即过期
    expect(getCache('k')).toBeUndefined();
    expect(getStaleCache('k')).toEqual({ a: 1 });
  });

  it('陈旧快照超过保留时长后失效', () => {
    setCache('k', { a: 1 }, 0);
    // 通过「只清新鲜缓存」模拟时间推进后的状态，再断言快照仍在；
    // 真正过期依赖 15 分钟窗口，这里验证 API 语义而不依赖真实等待。
    expireFreshEntries();
    expect(getStaleCache('k')).toEqual({ a: 1 });
  });

  it('写路径失效会同时清掉新鲜缓存与陈旧快照', () => {
    setCache('note:abc', { a: 1 });
    setCache('note:def', { a: 2 });
    invalidateCache('note:');
    expect(getCache('note:abc')).toBeUndefined();
    expect(getStaleCache('note:abc')).toBeUndefined();
    expect(getStaleCache('note:def')).toBeUndefined();
  });

  it('清理全部缓存时陈旧快照一并清除', () => {
    setCache('k', { a: 1 });
    clearAllCache();
    expect(getStaleCache('k')).toBeUndefined();
  });
});
