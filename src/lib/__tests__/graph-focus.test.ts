import { describe, expect, it } from 'vitest';
import type { GraphLink } from '@/lib/graph/graph-state';
import { collectNeighborIds, pathEdgeKey, shortestPath } from '@/lib/graph/graph-focus';

function link(source: string, target: string, kind = 'wiki'): GraphLink {
  return { source, target, kind, weight: 1 };
}

function adjacency(links: GraphLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const l of links) {
    const s = String(l.source);
    const t = String(l.target);
    add(s, t);
    add(t, s);
  }
  return map;
}

const chain = [link('a', 'b'), link('b', 'c', 'tag'), link('c', 'd', 'doc'), link('e', 'f')];

describe('graph-focus / collectNeighborIds', () => {
  const adj = adjacency(chain);

  it('一阶邻居包含 seed 与直接邻居', () => {
    expect([...collectNeighborIds(new Set(['a']), adj, 1)].sort()).toEqual(['a', 'b']);
  });

  it('二阶邻居覆盖两跳，不重复', () => {
    expect([...collectNeighborIds(new Set(['a']), adj, 2)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('多 seed 去重且保留各自邻居', () => {
    const result = collectNeighborIds(new Set(['a', 'c']), adj, 1);
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('无邻居时只返回 seed', () => {
    expect([...collectNeighborIds(new Set(['zzz']), adj, 2)]).toEqual(['zzz']);
  });

  it('maxNodes 截断时优先保留浅层，且结果稳定', () => {
    // 星形：s 连接 n1..n5，n1..n5 各连接 x1..x2
    const links: GraphLink[] = [];
    for (let i = 1; i <= 5; i += 1) {
      links.push(link('s', `n${i}`));
      links.push(link(`n${i}`, `x${i}a`));
      links.push(link(`n${i}`, `x${i}b`));
    }
    const star = adjacency(links);
    const result = collectNeighborIds(new Set(['s']), star, 2, 6);
    expect(result.size).toBe(6);
    // 1 seed + 5 个一阶（浅层优先）
    expect([...result].sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 's']);
    // 输入不被修改
    expect(star.get('s')?.size).toBe(5);
  });

  it('不修改输入 adjacency / seed', () => {
    const seed = new Set(['a']);
    const before = JSON.stringify([...adj.entries()].map(([k, v]) => [k, [...v]]));
    collectNeighborIds(seed, adj, 2);
    expect([...seed]).toEqual(['a']);
    expect(JSON.stringify([...adj.entries()].map(([k, v]) => [k, [...v]]))).toBe(before);
  });
});

describe('graph-focus / shortestPath', () => {
  it('直达路径返回两节点与边类型', () => {
    const path = shortestPath(chain, 'a', 'b');
    expect(path?.nodeIds).toEqual(['a', 'b']);
    expect(path?.edges).toEqual([{ source: 'a', target: 'b', kind: 'wiki' }]);
  });

  it('间接路径选择最短跳数并保留每段类型', () => {
    const path = shortestPath(chain, 'a', 'd');
    expect(path?.nodeIds).toEqual(['a', 'b', 'c', 'd']);
    expect(path?.edges.map((edge) => edge.kind)).toEqual(['wiki', 'tag', 'doc']);
  });

  it('方向无关：反向查询同样可达', () => {
    const path = shortestPath(chain, 'c', 'a');
    expect(path?.nodeIds).toEqual(['c', 'b', 'a']);
  });

  it('无路径返回 null', () => {
    expect(shortestPath(chain, 'a', 'e')).toBeNull();
  });

  it('同一节点返回单节点路径', () => {
    expect(shortestPath(chain, 'a', 'a')).toEqual({ nodeIds: ['a'], edges: [] });
  });

  it('忽略自环且不修改 links', () => {
    const links = [...chain, link('a', 'a')];
    const before = JSON.stringify(links);
    expect(shortestPath(links, 'a', 'a')?.nodeIds).toEqual(['a']);
    expect(JSON.stringify(links)).toBe(before);
  });

  it('两节点间多条平行边时结果稳定（按 kind 字典序）', () => {
    const links = [link('a', 'b', 'wiki'), link('a', 'b', 'tag')];
    const path = shortestPath(links, 'a', 'b');
    expect(path?.edges).toHaveLength(1);
    expect(path?.edges[0].kind).toBe('tag');
  });

  it('pathEdgeKey 无向规范化', () => {
    expect(pathEdgeKey('b', 'a')).toBe('a|b');
    expect(pathEdgeKey('a', 'b')).toBe('a|b');
  });
});
