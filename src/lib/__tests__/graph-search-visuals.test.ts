import { describe, expect, it } from 'vitest';
import {
  computeLinkColor,
  computeLinkWidth,
  computeSearchNeighborIds,
  type GraphLink,
} from '@/lib/graph/graph-state';

const adjacency = new Map<string, Set<string>>([
  ['a', new Set(['b', 'c'])],
  ['b', new Set(['a'])],
  ['c', new Set(['a'])],
  ['d', new Set(['e'])],
  ['e', new Set(['d'])],
]);

function link(source: string, target: string, kind = 'wiki', weight = 1): GraphLink {
  return { source, target, kind, weight };
}

describe('search visual helpers', () => {
  it('一阶邻居 = 命中节点邻居去掉命中本身', () => {
    const near = computeSearchNeighborIds(new Set(['a']), adjacency);
    expect([...near].sort()).toEqual(['b', 'c']);
  });

  it('多命中节点时邻居去重', () => {
    const near = computeSearchNeighborIds(new Set(['a', 'b']), adjacency);
    expect([...near].sort()).toEqual(['c']);
  });

  it('命中路径（两端命中）提亮，命中↔非邻居保持基础亮度，无关边淡化', () => {
    const search = { matchedIds: new Set(['a']), neighborIds: new Set(['b', 'c']) };
    const base = computeLinkColor(link('d', 'e'), { matchedIds: null, neighborIds: null }, null, null);
    expect(computeLinkColor(link('d', 'e'), search, null, null)).not.toBe(base);
    // 命中↔邻居：保持基础亮度
    expect(computeLinkColor(link('a', 'b'), search, null, null)).toBe(
      computeLinkColor(link('d', 'e'), { matchedIds: null, neighborIds: null }, null, null),
    );
    // 两端命中：提亮（不等于基础色）
    const hitSearch = { matchedIds: new Set(['a', 'b']), neighborIds: new Set(['c']) };
    expect(computeLinkColor(link('a', 'b'), hitSearch, null, null)).not.toBe(
      computeLinkColor(link('d', 'e'), { matchedIds: null, neighborIds: null }, null, null),
    );
  });

  it('仅旧筛选命中（neighborIds=null）时保持阶段 1 语义：两端命中才可见', () => {
    const matched = new Set(['a', 'b']);
    const both = computeLinkColor(link('a', 'b'), { matchedIds: matched, neighborIds: null }, null, null);
    const one = computeLinkColor(link('a', 'c'), { matchedIds: matched, neighborIds: null }, null, null);
    expect(both.length).toBeGreaterThan(0);
    expect(one.endsWith('20')).toBe(true);
  });

  it('搜索命中路径宽度额外 ×1.8，其他边不加成', () => {
    expect(computeLinkWidth(link('a', 'b', 'wiki', 2), null, 1, 1.8)).toBeCloseTo(3.6);
    expect(computeLinkWidth(link('a', 'b', 'wiki', 2), null, 1, 1)).toBeCloseTo(2);
  });
});
