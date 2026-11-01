import { describe, expect, it } from 'vitest';
import { computeLinkColor, computeLinkWidth, KINDS } from '@/lib/graph/graph-state';
import type { GraphLink } from '@/lib/graph/graph-types';

const link = (source: string, target: string, kind = 'wiki', weight = 1): GraphLink => ({
  source,
  target,
  kind,
  weight,
});

const noSearch = { matchedIds: null, neighborIds: null };

describe('连线绘制参数：computeLinkColor + computeLinkWidth', () => {
  it('无交互态时输出各关系类型基础色与权重宽度', () => {
    const wiki = link('a', 'b', 'wiki', 1);
    const tag = link('b', 'c', 'tag', 0.8);
    expect(computeLinkColor(wiki, noSearch, null, null)).toBe(KINDS[0].color);
    expect(computeLinkColor(tag, noSearch, null, null)).toBe(KINDS[1].color);
    expect(computeLinkWidth(wiki, null, 1)).toBe(1);
    expect(computeLinkWidth(tag, null, 1)).toBe(0.8);
  });

  it('悬停端点时颜色提亮、宽度 ×1.8', () => {
    const value = link('a', 'b');
    const hoverSet = new Set(['a', 'b']);
    expect(computeLinkColor(value, noSearch, hoverSet, 'a')).not.toBe(KINDS[0].color);
    expect(computeLinkWidth(value, 'a', 1)).toBeCloseTo(1.8, 5);
  });

  it('搜索命中路径使用提亮色并应用调用方传入的宽度加成', () => {
    const hit = link('a', 'b');
    const unrelated = link('c', 'd');
    const search = { matchedIds: new Set(['a', 'b']), neighborIds: new Set<string>() };
    expect(computeLinkColor(hit, search, null, null)).not.toBe(KINDS[0].color);
    expect(computeLinkColor(unrelated, search, null, null)).toBe(`${KINDS[0].color}20`);
    expect(computeLinkWidth(hit, null, 1, 1.8)).toBeCloseTo(1.8, 5);
    expect(computeLinkWidth(unrelated, null, 1, 1)).toBe(1);
  });

  it('最短路径边应用 2.2× 宽度加成', () => {
    const onPath = link('a', 'b');
    const offPath = link('c', 'd');
    const search = { ...noSearch, pathEdgeKeys: new Set(['a|b']) };
    expect(computeLinkWidth(onPath, null, 1, 1, 2.2)).toBeCloseTo(2.2, 5);
    expect(computeLinkColor(offPath, search, null, null)).toBe(`${KINDS[0].color}20`);
  });

  it('按 linkWidthMult 缩放，并始终钳制到最小 0.5', () => {
    const value = link('a', 'b', 'wiki', 1);
    expect(computeLinkWidth(value, null, 2)).toBe(2);
    expect(computeLinkWidth(link('a', 'b', 'tag', 0.1), null, 1)).toBe(0.5);
  });

  it('未知关系类型退回默认深色，不抛错', () => {
    const unknown = link('a', 'b', 'unknown');
    expect(computeLinkColor(unknown, noSearch, null, null)).toBe(KINDS[2].color);
  });
});
