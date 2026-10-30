import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@/lib/graph/graph-types';
import { computeMapMarks, countMapMarks, MAP_MARK_META } from '@/lib/graph/graph-map';

function node(id: string, memory: number): GraphNode {
  return { id, title: id, memory, viewCount: 0, readingMs: 0, documentTitle: null };
}

function adjacency(pairs: [string, string][]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  return map;
}

const nodes = [node('a', 0.1), node('b', 0.5), node('c', 0.7), node('d', 0.2), node('e', 0.9)];
const adj = adjacency([
  ['a', 'b'],
  ['a', 'c'],
  ['a', 'd'],
  ['b', 'c'],
  ['c', 'd'],
  ['e', 'a'],
]);

describe('graph-map', () => {
  it('薄弱 = memory < 0.4（可配置阈值）', () => {
    const marks = computeMapMarks(nodes, adj);
    expect(marks.get('a')?.weak).toBe(true);
    expect(marks.get('d')?.weak).toBe(true);
    expect(marks.has('b')).toBe(false);
    const custom = computeMapMarks(nodes, adj, [], { weakThreshold: 0.8 });
    expect(custom.get('b')?.weak).toBe(true);
    expect(custom.get('c')?.weak).toBe(true);
  });

  it('到期复习与今日推荐按 reasonCode 区分', () => {
    const marks = computeMapMarks(nodes, adj, [
      { segmentId: 'a', reasonCode: 'due-review' },
      { segmentId: 'b', reasonCode: 'new-knowledge' },
      { segmentId: 'c', reasonCode: 'continue-learning' },
      { segmentId: 'a', reasonCode: 'scheduled' },
    ]);
    expect(marks.get('a')?.due).toBe(true);
    expect(marks.get('a')?.today).toBe(true);
    expect(marks.get('b')?.today).toBe(true);
    expect(marks.get('c')?.today).toBe(true);
    expect(marks.get('b')?.due).toBe(false);
  });

  it('枢纽 = 度数 Top 10%（默认至少 1 个，minDegree 2）', () => {
    const marks = computeMapMarks(nodes, adj);
    // 度数：a=4, c=3, b=2, d=2, e=1 → top 10% of 4 = 1 → a
    expect(marks.get('a')?.hub).toBe(true);
    expect(marks.get('c')?.hub ?? false).toBe(false);
    expect(marks.has('e')).toBe(false); // degree 1 < minDegree
  });

  it('小图枢纽按 ceil(10%)、且 ties 按 id 稳定', () => {
    const tiny = [node('x', 0.5), node('y', 0.5), node('z', 0.5)];
    const tinyAdj = adjacency([
      ['x', 'y'],
      ['x', 'z'],
      ['y', 'z'],
    ]);
    const marks = computeMapMarks(tiny, tinyAdj, [], { hubTopRatio: 0.1 });
    // 3 节点 → ceil(0.3)=1；三者度数并列 2，按 id 字典序取 x
    expect(marks.get('x')?.hub).toBe(true);
    expect(marks.has('y')).toBe(false);
    expect(marks.has('z')).toBe(false);
  });

  it('空数据 / 无标记节点返回空 Map', () => {
    expect(computeMapMarks([], new Map()).size).toBe(0);
    const clean = [node('clean', 0.8)];
    expect(computeMapMarks(clean, new Map()).size).toBe(0);
  });

  it('countMapMarks 与图例元数据完整', () => {
    const marks = computeMapMarks(nodes, adj, [
      { segmentId: 'a', reasonCode: 'due-review' },
      { segmentId: 'b', reasonCode: 'new-knowledge' },
    ]);
    const counts = countMapMarks(marks);
    expect(counts.weak).toBe(2);
    expect(counts.due).toBe(1);
    expect(counts.today).toBe(1);
    expect(counts.hub).toBe(1);
    for (const meta of Object.values(MAP_MARK_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(meta.description).toBeTruthy();
    }
  });

  it('不修改输入节点/邻接', () => {
    const before = JSON.stringify(nodes);
    const adjBefore = JSON.stringify([...adj.entries()].map(([k, v]) => [k, [...v]]));
    computeMapMarks(nodes, adj, [{ segmentId: 'a', reasonCode: 'due-review' }]);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(JSON.stringify([...adj.entries()].map(([k, v]) => [k, [...v]]))).toBe(adjBefore);
  });
});
