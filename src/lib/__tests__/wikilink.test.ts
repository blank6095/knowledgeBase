import { describe, expect, it } from 'vitest';
import remarkWikiLink from '@/lib/remark-wikilink';
import { buildWikiIndex, parseWikiLink, resolveWikiTarget } from '@/lib/wikilink';

describe('parseWikiLink：`[[标题]]` / `[[标题|别名]]`', () => {
  it('解析纯标题与别名', () => {
    expect(parseWikiLink('[[索引]]')).toEqual({ raw: '[[索引]]', title: '索引', alias: null, display: '索引' });
    expect(parseWikiLink('[[索引|目录]]')).toEqual({
      raw: '[[索引|目录]]',
      title: '索引',
      alias: '目录',
      display: '目录',
    });
  });

  it('非双链文本返回 null', () => {
    expect(parseWikiLink('普通文本')).toBeNull();
    expect(parseWikiLink('[[未闭合')).toBeNull();
    expect(parseWikiLink('[[]]')).toBeNull();
  });
});

describe('buildWikiIndex / resolveWikiTarget：标题到知识点', () => {
  const nodes = [
    { id: 'b', title: '索引', documentTitle: '数据库笔记' },
    { id: 'a', title: '索引', documentTitle: 'Redis 笔记' },
    { id: 'c', title: 'Hash 冲突', documentTitle: '数据库笔记' },
  ];
  const index = buildWikiIndex(nodes);

  it('同文档优先解析（避免同名段误跳）', () => {
    const result = resolveWikiTarget(index, '索引', 'Redis 笔记');
    expect(result).toEqual({ status: 'resolved', target: index.get('索引')![1], ambiguous: false });
  });

  it('无同文档候选时取唯一匹配', () => {
    const result = resolveWikiTarget(index, 'Hash 冲突', '别的文档');
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.target.segmentId).toBe('c');
  });

  it('多候选且无同文档匹配时标记 ambiguous 并给稳定候选（按 id 排序）', () => {
    const result = resolveWikiTarget(index, '索引', '无关文档');
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.ambiguous).toBe(true);
      expect(result.target.segmentId).toBe('a');
    }
  });

  it('标题不存在 → missing（渲染为断链）', () => {
    expect(resolveWikiTarget(index, '不存在的标题')).toEqual({ status: 'missing' });
  });

  it('大小写与首尾空格不敏感', () => {
    const en = buildWikiIndex([{ id: 'x', title: 'React Hooks' }]);
    expect(resolveWikiTarget(en, '  react hooks ').status).toBe('resolved');
  });
});

interface TreeNode {
  type: string;
  value?: string;
  url?: string;
  children?: TreeNode[];
}

const runPlugin = (tree: TreeNode) => {
  remarkWikiLink()(tree);
  return tree;
};

describe('remarkWikiLink：mdast 转换', () => {
  it('把 [[标题]] 转成 wiki: 链接，且链接文本保留原文（批注锚点依赖 textContent 一致）', () => {
    const tree = runPlugin({
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '参见 [[索引]] 与 [[索引|目录]]。' }] }],
    });
    const paragraph = tree.children![0];
    const links = paragraph.children!.filter((node) => node.type === 'link');

    expect(links).toHaveLength(2);
    expect(links[0].url).toBe(`wiki:${encodeURIComponent('索引')}`);
    expect(links[0].children?.[0].value).toBe('[[索引]]');
    expect(links[1].children?.[0].value).toBe('[[索引|目录]]');
    // 前后普通文本保持
    expect(paragraph.children![0].value).toBe('参见 ');
  });

  it('跳过行内代码与已有链接，避免代码里的 [[x]] 被误转', () => {
    const tree = runPlugin({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: '[[不动]]' },
            { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '[[也不动]]' }] },
          ],
        },
      ],
    });

    const paragraph = tree.children![0];
    expect(paragraph.children!.every((node) => node.type !== 'link' || node.url === 'https://example.com')).toBe(true);
    expect(paragraph.children![0].type).toBe('inlineCode');
  });
});
