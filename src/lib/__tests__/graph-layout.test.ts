import { describe, expect, it } from 'vitest';
import { CLUSTER_SPACING, computeClusterAnchors, computeClusterLayout, LAYER_GAP } from '@/lib/graph/graph-layout';
import type { GraphLink, GraphNode } from '@/lib/graph/graph-types';

const node = (id: string): GraphNode => ({
  id,
  title: id,
  memory: 0.5,
  viewCount: 0,
  readingMs: 0,
  documentTitle: null,
});

const link = (s: string, t: string, kind = 'wiki'): GraphLink => ({ source: s, target: t, kind, weight: 1 });

describe('computeClusterLayout：首次加载的聚合预布局', () => {
  it('空图返回空 Map', () => {
    expect(computeClusterLayout([], []).size).toBe(0);
  });

  it('单节点落在原点', () => {
    const layout = computeClusterLayout([node('a')], []);
    expect(layout.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('星形：度数最高者居中，其余按螺旋外扩且互不重合', () => {
    const nodes = [node('hub'), node('a'), node('b'), node('c')];
    const links = [link('hub', 'a'), link('hub', 'b'), link('hub', 'c')];
    const layout = computeClusterLayout(nodes, links);

    expect(layout.get('hub')).toEqual({ x: 0, y: 0 });
    const radii = ['a', 'b', 'c'].map((id) => {
      const point = layout.get(id)!;
      return Math.hypot(point.x, point.y);
    });
    // 度数相同按 id 排序，半径按 √index 递增（面积均匀的螺旋）
    expect(radii[0]).toBeCloseTo(CLUSTER_SPACING, 6);
    expect(radii[1]).toBeCloseTo(CLUSTER_SPACING * Math.sqrt(2), 6);
    expect(radii[2]).toBeCloseTo(CLUSTER_SPACING * Math.sqrt(3), 6);
    const keys = new Set(['a', 'b', 'c'].map((id) => `${layout.get(id)!.x.toFixed(3)},${layout.get(id)!.y.toFixed(3)}`));
    expect(keys.size).toBe(3);
  });

  it('多个连通分量互不重叠：组间距离大于组内半径之和的一半', () => {
    const nodes = [node('a1'), node('a2'), node('b1'), node('b2')];
    const links = [link('a1', 'a2'), link('b1', 'b2')];
    const layout = computeClusterLayout(nodes, links);

    const centroid = (ids: string[]) => {
      const points = ids.map((id) => layout.get(id)!);
      return {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
    };
    const a = centroid(['a1', 'a2']);
    const b = centroid(['b1', 'b2']);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);

    expect(distance).toBeGreaterThan(LAYER_GAP);
  });

  it('优先按 doc 边分簇：跨文档 tag 边不会把两篇笔记合并成一个 BFS 径向树', () => {
    const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map(node);
    const links = [
      link('a1', 'a2', 'doc'),
      link('a2', 'a3', 'doc'),
      link('b1', 'b2', 'doc'),
      link('b2', 'b3', 'doc'),
      link('a1', 'b1', 'tag'), // 跨文档弱连接
    ];
    const layout = computeClusterLayout(nodes, links);

    const centroid = (ids: string[]) => {
      const points = ids.map((id) => layout.get(id)!);
      return {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
    };
    const a = centroid(['a1', 'a2', 'a3']);
    const b = centroid(['b1', 'b2', 'b3']);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);

    // 两个文档簇应在空间上分开（各自内部半径不超过 2 层）
    expect(distance).toBeGreaterThan(LAYER_GAP * 2);
  });

  it('doc 边覆盖不足时退回全量边（历史压测数据只有 wiki/tag 边）', () => {
    const nodes = ['a1', 'a2', 'b1', 'b2'].map(node);
    const links = [link('a1', 'a2', 'wiki'), link('b1', 'b2', 'wiki')];
    const layout = computeClusterLayout(nodes, links);

    expect(layout.size).toBe(4);
    expect(layout.get('a1')).toBeDefined();
    expect(layout.get('b2')).toBeDefined();
  });

  it('结果是确定的：同样输入两次调用完全一致', () => {
    const nodes = [node('x'), node('y'), node('z')];
    const links = [link('x', 'y'), link('y', 'z')];
    expect(computeClusterLayout(nodes, links)).toEqual(computeClusterLayout(nodes, links));
  });

  it('为所有节点产出有限坐标，且不修改入参', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const links = [link('a', 'b'), link('b', 'c')];
    const layout = computeClusterLayout(nodes, links);

    expect(layout.size).toBe(3);
    for (const point of layout.values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(nodes.every((n) => !('x' in n))).toBe(true);
  });

  it('按度数排序的螺旋：枢纽在内圈、叶子在外圈，半径随序号增大', () => {
    const nodes = ['n0', 'n1', 'n2', 'n3', 'n4'].map(node);
    const links = [link('n0', 'n1'), link('n1', 'n2'), link('n2', 'n3'), link('n3', 'n4')];
    const layout = computeClusterLayout(nodes, links);

    const radius = (id: string) => Math.hypot(layout.get(id)!.x, layout.get(id)!.y);
    // 度数：n1/n2/n3=2 排前，n0/n4=1 排后
    expect(radius('n1')).toBeCloseTo(0, 6);
    expect(radius('n2')).toBeCloseTo(CLUSTER_SPACING, 6);
    expect(radius('n3')).toBeCloseTo(CLUSTER_SPACING * Math.sqrt(2), 6);
    expect(radius('n0')).toBeGreaterThan(radius('n3'));
    expect(radius('n4')).toBeGreaterThan(radius('n0'));
  });

  it('大量卫星簇装箱：互不重叠且紧凑（星系分层，环距不随簇数爆炸）', () => {
    // 主簇 20 节点链 + 30 个尺寸各异的卫星簇（模拟 211 个文档簇的场景）
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const chain = (prefix: string, size: number) => {
      for (let i = 0; i < size; i += 1) nodes.push(node(`${prefix}${i}`));
      for (let i = 1; i < size; i += 1) links.push(link(`${prefix}${i - 1}`, `${prefix}${i}`));
    };
    chain('m', 20);
    const satelliteSizes = Array.from({ length: 30 }, (_, i) => 4 + ((i * 7) % 20));
    satelliteSizes.forEach((size, index) => chain(`s${index}_`, size));

    const anchors = computeClusterAnchors(nodes, links);
    const layout = computeClusterLayout(nodes, links);
    // 每个簇的实际半径：簇内节点到锚点的最大距离
    const clusterRadius = (prefix: string, size: number) => {
      const anchor = anchors.get(`${prefix}0`)!;
      let r = 0;
      for (let i = 0; i < size; i += 1) {
        const p = layout.get(`${prefix}${i}`)!;
        r = Math.max(r, Math.hypot(p.x - anchor.x, p.y - anchor.y));
      }
      return r;
    };
    const clusters = [
      { prefix: 'm', size: 20 },
      ...satelliteSizes.map((size, index) => ({ prefix: `s${index}_`, size })),
    ].map(({ prefix, size }) => {
      const anchor = anchors.get(`${prefix}0`)!;
      return { x: anchor.x, y: anchor.y, r: clusterRadius(prefix, size) };
    });

    // 1) 任意两簇不重叠（中心距 ≥ 半径之和，留白 ≥ 0）
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThanOrEqual(a.r + b.r - 0.01);
      }
    }
    // 2) 紧凑：外缘半径与「总面积」同量级（向日葵装箱半径 ∝ √Σ(r+gap)²），
    //    而不是随簇数量线性/正弦爆炸。旧两环算法在本场景 > 3 万 px。
    const total = clusters.reduce((s, c) => s + (c.r + CLUSTER_SPACING) ** 2, 0);
    const expected = 2.2 * Math.sqrt(total);
    const maxR = Math.max(...clusters.map((c) => Math.hypot(c.x, c.y) + c.r));
    expect(maxR).toBeLessThan(expected);
  });
});
