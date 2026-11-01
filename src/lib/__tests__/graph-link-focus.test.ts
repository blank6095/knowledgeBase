import { describe, expect, it } from 'vitest';
import { computeLinkColor, KINDS } from '@/lib/graph/graph-state';
import type { GraphLink } from '@/lib/graph/graph-types';

const link = (s: string, t: string, kind = 'wiki'): GraphLink => ({ source: s, target: t, kind, weight: 1 });
const baseWiki = KINDS.find((k) => k.kind === 'wiki')!.color;
const dimWiki = `${baseWiki}20`;
const noSearch = { matchedIds: null, neighborIds: null };

describe('computeLinkColor：聚焦时只保留直接相连的边', () => {
  it('未聚焦时与旧行为一致（基础色）', () => {
    expect(computeLinkColor(link('a', 'b'), noSearch, null, null)).toBe(baseWiki);
  });

  it('两端都不在聚焦集合 → 淡化；一端或两端在集合 → 基础色', () => {
    const focus = new Set(['a', 'b']);
    expect(computeLinkColor(link('a', 'b'), noSearch, null, null, focus)).toBe(baseWiki);
    expect(computeLinkColor(link('a', 'c'), noSearch, null, null, focus)).toBe(baseWiki);
    expect(computeLinkColor(link('c', 'd'), noSearch, null, null, focus)).toBe(dimWiki);
  });

  it('聚焦优先于搜索高亮：无关边即使两端命中搜索也保持淡化', () => {
    const search = { matchedIds: new Set(['c', 'd']), neighborIds: new Set<string>() };
    const focus = new Set(['a', 'b']);
    expect(computeLinkColor(link('c', 'd'), search, null, null, focus)).toBe(dimWiki);
  });

  it('聚焦集合内悬停时提亮', () => {
    const focus = new Set(['a', 'b', 'c']);
    expect(computeLinkColor(link('a', 'c'), noSearch, null, 'a', focus)).not.toBe(baseWiki);
  });

  it('空聚焦集合等价于全部淡化（选中节点不存在时的防御语义）', () => {
    expect(computeLinkColor(link('a', 'b'), noSearch, null, null, new Set())).toBe(dimWiki);
  });
});
