import { describe, expect, it } from 'vitest';
import { createDetailCache, DETAIL_CACHE_TTL_MS } from '@/lib/graph/graph-detail-cache';

interface Detail {
  title: string;
  summary: string;
}

describe('createDetailCache（UX-30 详情缓存失效）', () => {
  it('写入后可读；未写入命中 undefined', () => {
    const cache = createDetailCache<Detail>();
    cache.set('a', { title: '旧标题', summary: '旧摘要' });
    expect(cache.get('a')).toEqual({ title: '旧标题', summary: '旧摘要' });
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('invalidate 只清除目标条目，且可重复调用（幂等）', () => {
    const cache = createDetailCache<Detail>();
    cache.set('a', { title: 'A', summary: '' });
    cache.set('b', { title: 'B', summary: '' });

    expect(cache.invalidate('a')).toBe(true);
    expect(cache.invalidate('a')).toBe(false);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.title).toBe('B');
    expect(cache.size).toBe(1);
  });

  it('invalidateAll 清空全部条目', () => {
    const cache = createDetailCache<Detail>();
    cache.set('a', { title: 'A', summary: '' });
    cache.set('b', { title: 'B', summary: '' });
    cache.invalidateAll();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('编辑段落后失效再写入，读到的是新值（UX-30 场景）', () => {
    const cache = createDetailCache<Detail>();
    cache.set('seg-1', { title: '旧标题', summary: '旧摘要' });
    // 模拟编辑保存：显式失效
    cache.invalidate('seg-1');
    // 重新选中节点后拉取到新数据
    cache.set('seg-1', { title: '新标题', summary: '新摘要' });
    expect(cache.get('seg-1')).toEqual({ title: '新标题', summary: '新摘要' });
  });

  it('超过 TTL 自动过期，按未命中处理并清出 size', () => {
    let clock = 0;
    const cache = createDetailCache<Detail>({ ttlMs: 1_000, now: () => clock });
    cache.set('a', { title: 'A', summary: '' });

    clock = 999;
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')?.title).toBe('A');

    clock = 1_000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('TTL <= 0 表示永不过期', () => {
    let clock = 0;
    const cache = createDetailCache<Detail>({ ttlMs: 0, now: () => clock });
    cache.set('a', { title: 'A', summary: '' });
    clock = DETAIL_CACHE_TTL_MS * 10;
    expect(cache.get('a')?.title).toBe('A');
  });

  it('size 只统计未过期条目', () => {
    let clock = 0;
    const cache = createDetailCache<Detail>({ ttlMs: 1_000, now: () => clock });
    cache.set('a', { title: 'A', summary: '' });
    clock = 500;
    cache.set('b', { title: 'B', summary: '' });
    clock = 1_400;
    // a 已过期（1400 - 0 >= 1000），b 仍有效（1400 - 500 < 1000）
    expect(cache.size).toBe(1);
  });
});
