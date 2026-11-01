import { describe, expect, it } from 'vitest';
import { buildDisplayLabels, buildGraphData } from '@/lib/graph/graph-state';
import { MEMORY_TIER_ORDER } from '@/lib/memory';
import type { GraphLink } from '@/lib/graph/graph-types';

const node = (id: string, title: string = id, documentTitle: string | null = null) => ({
  id,
  title,
  memory: 0.5,
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

describe('buildGraphData：孤立点与重复边治理', () => {
  it('默认保留孤立点；hideOrphans 打开后移除没有可见连线的节点', () => {
    const nodes = [node('a'), node('b'), node('orphan')];
    const links = [link('a', 'b')];

    expect(buildGraphData(nodes, links, tierOn, kindOn).nodes).toHaveLength(3);
    const filtered = buildGraphData(nodes, links, tierOn, kindOn, null, { hideOrphans: true });
    expect(filtered.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(filtered.links).toHaveLength(1);
  });

  it('被类型过滤掉的节点不算孤立点（避免误判）', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const links = [link('a', 'b', 'doc'), link('b', 'c', 'doc')];
    const filtered = buildGraphData(nodes, links, tierOn, { wiki: true, tag: true, doc: false }, null, {
      hideOrphans: true,
    });
    // doc 边被关闭后三个节点都无边 → 全部隐藏
    expect(filtered.nodes).toHaveLength(0);
  });

  it('dedupeLinks 合并同一对节点的多条关系，保留语义最强的一条', () => {
    const nodes = [node('a'), node('b')];
    const links = [link('a', 'b', 'doc'), link('a', 'b', 'tag'), link('a', 'b', 'wiki')];

    expect(buildGraphData(nodes, links, tierOn, kindOn).links).toHaveLength(3);
    const deduped = buildGraphData(nodes, links, tierOn, kindOn, null, { dedupeLinks: true });
    // doc 是结构边，不参与去重；wiki/tag 合并后只留 wiki
    expect(deduped.links).toHaveLength(2);
    expect(deduped.links.map((l) => l.kind).sort()).toEqual(['doc', 'wiki']);
  });

  it('弱标签边（weight < 0.5）始终不参与布局与绘制', () => {
    const nodes = [node('a'), node('b')];
    const links = [link('a', 'b', 'tag', 0.33)];
    expect(buildGraphData(nodes, links, tierOn, kindOn).links).toHaveLength(0);
  });
});

describe('buildDisplayLabels：同名节点消歧', () => {
  it('标题唯一时保持原样，重复时追加文档简称', () => {
    const labels = buildDisplayLabels([
      node('1', '索引', '数据库笔记'),
      node('2', '索引', 'Redis 笔记'),
      node('3', '唯一标题', '数据库笔记'),
    ]);

    expect(labels.get('1')).toBe('索引 · 数据库笔记');
    expect(labels.get('2')).toBe('索引 · Redis 笔记');
    expect(labels.get('3')).toBe('唯一标题');
  });

  it('重复标题但缺文档名时退回原标题（不产生悬空后缀）', () => {
    const labels = buildDisplayLabels([node('1', '索引'), node('2', '索引')]);
    expect(labels.get('1')).toBe('索引');
    expect(labels.get('2')).toBe('索引');
  });

  it('文档名过长时截断，避免标签撑爆画布', () => {
    const labels = buildDisplayLabels([node('1', '索引', '一个非常长的文档名称超过八个字'), node('2', '索引', '另一篇')]);
    expect(labels.get('1')).toBe('索引 · 一个非常长的文档');
  });
});
