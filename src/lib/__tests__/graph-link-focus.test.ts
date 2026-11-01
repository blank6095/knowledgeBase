import { describe, expect, it } from 'vitest';
import { computeLinkColor, computeLinkWidth, KINDS } from '@/lib/graph/graph-state';
import type { GraphLink } from '@/lib/graph/graph-types';

const link = (source: string, target: string, kind = 'wiki'): GraphLink => ({
  source,
  target,
  kind,
  weight: 1,
});

const baseWiki = KINDS.find((item) => item.kind === 'wiki')!.color;
const dimWiki = `${baseWiki}20`;
const noSearch = { matchedIds: null, neighborIds: null };

describe('computeLinkColor：搜索、路径与悬停状态', () => {
  it('无交互态时返回关系类型基础色', () => {
    expect(computeLinkColor(link('a', 'b'), noSearch, null, null)).toBe(baseWiki);
  });

  it('浮层搜索两端命中时提亮，无关边压暗', () => {
    const search = { matchedIds: new Set(['a', 'b']), neighborIds: new Set<string>() };
    expect(computeLinkColor(link('a', 'b'), search, null, null)).not.toBe(baseWiki);
    expect(computeLinkColor(link('c', 'd'), search, null, null)).toBe(dimWiki);
  });

  it('最短路径边优先提亮，路径外全部压暗', () => {
    const search = {
      matchedIds: new Set(['c', 'd']),
      neighborIds: new Set<string>(),
      pathEdgeKeys: new Set(['a|b']),
    };
    expect(computeLinkColor(link('a', 'b'), search, null, null)).not.toBe(baseWiki);
    expect(computeLinkColor(link('c', 'd'), search, null, null)).toBe(dimWiki);
  });

  it('空路径集合表示“没有可高亮连线”，所有边压暗', () => {
    const search = { ...noSearch, pathEdgeKeys: new Set<string>() };
    expect(computeLinkColor(link('a', 'b'), search, null, null)).toBe(dimWiki);
  });

  it('悬停端点时提亮基础路径', () => {
    const focus = new Set(['a', 'b']);
    expect(computeLinkColor(link('a', 'b'), noSearch, focus, 'a')).not.toBe(baseWiki);
  });

  it('搜索路径加成与路径加成可叠加到线宽', () => {
    expect(computeLinkWidth(link('a', 'b'), null, 1, 1.8, 2.2)).toBeCloseTo(3.96, 5);
  });
});
