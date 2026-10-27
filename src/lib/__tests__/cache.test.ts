import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCache, getCache, invalidateCache, setCache } from '../cache';

const NOW = new Date('2026-10-26T10:00:00Z');
const MAX_ENTRIES = 64;

describe('统一读缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clearAllCache();
  });

  afterEach(() => {
    clearAllCache();
    vi.useRealTimers();
  });

  it('set 后 get 命中同一对象', () => {
    const value = { nodes: [], edges: [] };
    setCache('graph', value);
    expect(getCache<typeof value>('graph')).toBe(value);
  });

  it('未写入的 key 返回 undefined', () => {
    expect(getCache('missing')).toBeUndefined();
  });

  it('TTL 到期后返回 undefined（60s 边界即过期）', () => {
    setCache('stats', { total: 1 }, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(getCache('stats')).toEqual({ total: 1 });
    vi.advanceTimersByTime(1);
    expect(getCache('stats')).toBeUndefined();
  });

  it('自定义 TTL 生效', () => {
    setCache('ai-config', 'v', 300_000);
    vi.advanceTimersByTime(299_999);
    expect(getCache('ai-config')).toBe('v');
    vi.advanceTimersByTime(1);
    expect(getCache('ai-config')).toBeUndefined();
  });

  it('精确失效只删除该 key', () => {
    setCache('graph', 1);
    setCache('docs', 2);
    invalidateCache('graph');
    expect(getCache('graph')).toBeUndefined();
    expect(getCache('docs')).toBe(2);
  });

  it('前缀失效删除所有匹配 key 且不误删其它 key', () => {
    setCache('note:a', 1);
    setCache('note:b', 2);
    setCache('docs', 3);
    invalidateCache('note:');
    expect(getCache('note:a')).toBeUndefined();
    expect(getCache('note:b')).toBeUndefined();
    expect(getCache('docs')).toBe(3);
  });

  it('容量达上限后新增第 65 个 key 淘汰最旧条目', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) setCache(`k${i}`, i);
    expect(getCache<number>('k0')).toBe(0);
    setCache('k64', MAX_ENTRIES);
    expect(getCache('k0')).toBeUndefined();
    expect(getCache<number>('k1')).toBe(1);
    expect(getCache<number>('k64')).toBe(MAX_ENTRIES);
  });

  it('覆盖已有 key 不新增容量、不触发淘汰', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) setCache(`k${i}`, i);
    setCache('k0', 'updated');
    setCache('k1', 'updated');
    expect(getCache('k0')).toBe('updated');
    expect(getCache('k1')).toBe('updated');
    expect(getCache<number>('k2')).toBe(2);
    // 仍然只有一个空位：第 65 个新 key 只会淘汰当前最旧（k2）
    setCache('k64', 64);
    expect(getCache('k0')).toBe('updated');
    expect(getCache('k2')).toBeUndefined();
    expect(getCache<number>('k3')).toBe(3);
  });

  it('clearAllCache 清空全部条目', () => {
    setCache('graph', 1);
    setCache('docs', 2);
    clearAllCache();
    expect(getCache('graph')).toBeUndefined();
    expect(getCache('docs')).toBeUndefined();
  });
});
