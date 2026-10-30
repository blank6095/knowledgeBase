import { describe, expect, it } from 'vitest';
import type { GraphNode } from '@/lib/graph/graph-types';
import { buildSearchIndex, reasonLabel, searchGraph } from '@/lib/graph/graph-search';

function node(partial: Partial<GraphNode> & { id: string; title: string }): GraphNode {
  return {
    memory: 0.5,
    viewCount: 0,
    readingMs: 0,
    documentTitle: null,
    ...partial,
  };
}

const nodes: GraphNode[] = [
  node({ id: 'a', title: 'TCP 与 UDP', tags: ['网络', '基础'], headingPath: '计算机网络基础 > 传输层', summary: '传输层两种协议的区别' }),
  node({ id: 'b', title: 'UDP 协议', tags: ['网络'], headingPath: '计算机网络基础 > 传输层', summary: '无连接协议' }),
  node({ id: 'c', title: 'HashMap', tags: ['Java', '集合'], headingPath: 'Java > 集合框架', summary: null }),
  node({ id: 'd', title: '网络分层', tags: [], headingPath: '', summary: 'OSI 与 TCP/IP' }),
];

const index = buildSearchIndex(nodes);

describe('graph-search', () => {
  it('空/空白查询返回空且不命中', () => {
    for (const q of ['', '   ', '\t\n']) {
      const result = searchGraph(index, q);
      expect(result.hits).toEqual([]);
      expect(result.matchedIds.size).toBe(0);
    }
  });

  it('大小写不敏感 + 标题精确优先', () => {
    const result = searchGraph(index, 'tcp 与 udp');
    expect(result.hits[0]).toMatchObject({ id: 'a', reason: 'title', score: 100 });
    expect(result.matchedIds.has('a')).toBe(true);
  });

  it('标题 startsWith 高于 includes', () => {
    const result = searchGraph(index, 'udp');
    expect(result.hits.map((hit) => hit.id)).toEqual(['b', 'a']);
    expect(result.hits[0].reason).toBe('title');
  });

  it('标签命中带 detail，且低于标题命中', () => {
    const result = searchGraph(index, '网络');
    const ids = result.hits.map((hit) => hit.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('d');
    // 标题不含「网络」但 headingPath 含「计算机网络」→ 路径命中；标签命中优先于路径
    const hitA = result.hits.find((hit) => hit.id === 'a');
    expect(hitA?.reason).toBe('tags');
    expect(hitA?.detail).toBe('网络');
  });

  it('headingPath 命中', () => {
    const result = searchGraph(index, '集合框架');
    expect(result.hits).toEqual([expect.objectContaining({ id: 'c', reason: 'headingPath' })]);
  });

  it('summary 命中（含 summary 为 null 的节点不报错）', () => {
    const result = searchGraph(index, '无连接');
    expect(result.hits[0]).toMatchObject({ id: 'b', reason: 'summary' });
    const nullSummary = searchGraph(index, 'HashMap');
    expect(nullSummary.hits[0]).toMatchObject({ id: 'c', reason: 'title' });
  });

  it('fixture 缺少 tags/summary/headingPath 时按空处理', () => {
    const fixtureNodes = [node({ id: 'x', title: '仅有标题' }), node({ id: 'y', title: '另一个' })];
    const fixtureIndex = buildSearchIndex(fixtureNodes);
    expect(searchGraph(fixtureIndex, '仅有').hits).toHaveLength(1);
    expect(searchGraph(fixtureIndex, '标题').matchedIds.size).toBe(1);
    expect(searchGraph(fixtureIndex, '不存在').matchedIds.size).toBe(0);
  });

  it('同节点多字段命中只保留最高优先级原因', () => {
    const result = searchGraph(index, 'TCP');
    const hitsForA = result.hits.filter((hit) => hit.id === 'a');
    const allMatches = [...result.matchedIds].filter((id) => id === 'a');
    expect(hitsForA).toHaveLength(1);
    expect(allMatches).toHaveLength(1);
    expect(hitsForA[0].reason).toBe('title');
  });

  it('limit 截断结果但不截断 matchedIds', () => {
    const result = searchGraph(index, '协议', 1);
    expect(result.hits).toHaveLength(1);
    expect(result.matchedIds.size).toBeGreaterThan(1);
  });

  it('超长查询不命中且不抛错', () => {
    const result = searchGraph(index, 'x'.repeat(5000));
    expect(result.hits).toEqual([]);
    expect(result.matchedIds.size).toBe(0);
  });

  it('结果按分数和标题排序稳定，reasonLabel 可读', () => {
    const result = searchGraph(index, 'udp');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(reasonLabel(result.hits[0].reason)).toBe('标题');
  });

  it('不修改输入节点数组', () => {
    const before = JSON.stringify(nodes);
    searchGraph(index, '网络');
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
