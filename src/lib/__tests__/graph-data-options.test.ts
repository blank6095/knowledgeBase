import { afterEach, describe, expect, it } from 'vitest';
import { buildGraphData, computeLinkWidth, positionCache } from '@/lib/graph/graph-state';
import { MEMORY_TIER_ORDER } from '@/lib/memory';
import type { GraphLink, GraphNode } from '@/lib/graph/graph-types';

const node = (
  id: string,
  title: string = id,
  memory = 0.5,
  documentTitle: string | null = null,
): GraphNode => ({
  id,
  title,
  memory,
  viewCount: 0,
  readingMs: 0,
  documentTitle,
});

const link = (source: string, target: string, kind = 'wiki', weight = 1): GraphLink => ({
  source,
  target,
  kind,
  weight,
});

const tierOn = Object.fromEntries(MEMORY_TIER_ORDER.map((tier) => [tier, true]));
const kindOn = { wiki: true, tag: true, doc: true };

afterEach(() => positionCache.clear());

describe('buildGraphData：当前图谱数据契约', () => {
  it('默认保留孤立点，并为其计算度为 0', () => {
    const data = buildGraphData([node('a'), node('b'), node('orphan')], [link('a', 'b')], tierOn, kindOn);
    expect(data.nodes.map((item) => item.id)).toEqual(['a', 'b', 'orphan']);
    expect(data.nodes.find((item) => item.id === 'orphan')?.degree).toBe(0);
  });

  it('按记忆档位过滤节点，并只保留两端可见的边', () => {
    const data = buildGraphData(
      [node('weak', '弱', 0.2), node('strong', '强', 0.9)],
      [link('weak', 'strong')],
      { ...tierOn, weak: false },
      kindOn,
    );
    expect(data.nodes.map((item) => item.id)).toEqual(['strong']);
    expect(data.links).toHaveLength(0);
  });

  it('被关联类型过滤掉的边不参与节点度数', () => {
    const data = buildGraphData(
      [node('a'), node('b'), node('c')],
      [link('a', 'b', 'doc'), link('b', 'c', 'wiki')],
      tierOn,
      { wiki: true, tag: true, doc: false },
    );
    expect(data.links).toHaveLength(1);
    expect(data.nodes.find((item) => item.id === 'b')?.degree).toBe(1);
    expect(data.nodes.find((item) => item.id === 'a')?.degree).toBe(0);
  });

  it('把布局停止后缓存的坐标注入新 graphData，同时不修改业务节点', () => {
    const source = node('a');
    positionCache.set('a', { x: 42, y: 84 });
    const data = buildGraphData([source], [], tierOn, kindOn);
    expect(data.nodes[0]).toMatchObject({ id: 'a', degree: 0, x: 42, y: 84 });
    expect(source).not.toHaveProperty('x');
  });

  it('弱标签边仍保留在数据中，由绘制宽度钳制到最小 0.5', () => {
    const weak = link('a', 'b', 'tag', 0.33);
    const data = buildGraphData([node('a'), node('b')], [weak], tierOn, kindOn);
    expect(data.links).toHaveLength(1);
    expect(computeLinkWidth(weak, null, 1)).toBe(0.5);
  });

  it('尚未加载节点时返回安全空数据', () => {
    expect(buildGraphData(null, [link('a', 'b')], tierOn, kindOn)).toEqual({ nodes: [], links: [] });
  });
});
