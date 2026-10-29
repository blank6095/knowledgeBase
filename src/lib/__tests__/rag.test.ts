import { describe, expect, it } from 'vitest';
import { buildContextBudget, scoreSegment, tokenize, type RagHit } from '../rag';

const T = (title: string, content: string, tags: string[] = []) => ({ title, content, tags });

describe('tokenize 查询分词', () => {
  it('英数词原样 + 中文 2-3 字滑窗', () => {
    expect(tokenize('font-display 布局偏移')).toEqual(
      expect.arrayContaining(['font-display', '布局', '局偏', '偏移', '布局偏', '局偏移']),
    );
  });

  it('去重且不含单字', () => {
    const t = tokenize('网络 网络 TCP 网');
    expect(t.filter((x) => x === '网络')).toHaveLength(1);
    expect(t).not.toContain('网');
    expect(t).toContain('tcp');
  });

  it('上限 24 个', () => {
    expect(tokenize('这是一段特别长的中文查询文本用来验证分词数量上限保护机制').length).toBeLessThanOrEqual(24);
  });
});

describe('buildContextBudget 总上下文预算', () => {
  const hits: RagHit[] = [
    { segmentId: '1', title: '高分', snippet: '甲'.repeat(20), score: 2 },
    { segmentId: '2', title: '低分', snippet: '乙'.repeat(20), score: 1 },
  ];

  it('未超限时保留全部输入', () => {
    const result = buildContextBudget({ material: '材料', profileBlock: '画像', ragHits: hits, maxChars: 200 });
    expect(result.material).toBe('材料');
    expect(result.profileBlock).toBe('画像');
    expect(result.contextUsed).toEqual(hits);
    expect(result.truncated).toBe(false);
  });

  it('超限先裁低优先级 RAG，再裁画像，最后才裁材料', () => {
    const ragClipped = buildContextBudget({ material: '材'.repeat(30), profileBlock: '像'.repeat(20), ragHits: hits, maxChars: 65 });
    expect(ragClipped.contextUsed).toHaveLength(0);
    expect(ragClipped.profileBlock).toBe('像'.repeat(20));
    expect(ragClipped.totalChars).toBeLessThanOrEqual(65);

    const profileClipped = buildContextBudget({ material: '材'.repeat(30), profileBlock: '像'.repeat(40), maxChars: 50 });
    expect(profileClipped.material).toBe('材'.repeat(30));
    expect(profileClipped.profileBlock.length).toBeLessThan(40);

    const materialClipped = buildContextBudget({ material: '材'.repeat(80), maxChars: 50 });
    expect(materialClipped.material).toHaveLength(50);
    expect(materialClipped.material.endsWith('…')).toBe(true);
    expect(materialClipped.totalChars).toBe(50);
  });
});

describe('scoreSegment 评分排序（关键词×3 + 标签×2）', () => {
  it('同标签 + 含关键词 + 无关 三者的排序符合权重设计', () => {
    const tokens = tokenize('字体布局偏移 网络协议');
    const withTagAndKeyword = T('字体的布局偏移', '讨论布局偏移的成因', ['字体']); // 关键词命中 + 标签命中
    const keywordOnly = T('网络协议基础', '讲网络协议分层', []); // 仅关键词命中
    const tagOnly = T('杂项笔记', '与查询无关的内容', ['字体']); // 仅标签命中
    const irrelevant = T('购物清单', '牛奶面包鸡蛋', ['生活']);

    const s = (seg: ReturnType<typeof T>) => scoreSegment(tokens, seg).score;
    // 同标签+关键词 > 仅关键词 > 仅标签 > 无关
    expect(s(withTagAndKeyword)).toBeGreaterThan(s(keywordOnly));
    expect(s(keywordOnly)).toBeGreaterThan(s(tagOnly));
    expect(s(tagOnly)).toBeGreaterThan(s(irrelevant));
    // 精确值：字体布局偏移 → 关键词命中（字体/布局/偏移…）与标签「字体」各计
    expect(scoreSegment(tokenize('布局偏移'), T('布局偏移', '布局偏移成因', ['字体'])).score).toBe(
      scoreSegment(tokenize('布局偏移'), T('布局偏移', '布局偏移成因', ['字体'])).keywordHits * 3 +
        scoreSegment(tokenize('布局偏移'), T('布局偏移', '布局偏移成因', ['字体'])).tagHits * 2,
    );
  });

  it('多关键词命中累加，零命中得零分', () => {
    const tokens = tokenize('布局偏移');
    expect(scoreSegment(tokens, T('无关', '内容完全不同', [])).score).toBe(0);
    // 滑窗产生 布局/局偏/偏移/布局偏/局偏移 共 5 个 token，全部命中 title
    const r = scoreSegment(tokens, T('布局偏移', 'x', []));
    expect(r.keywordHits).toBe(tokens.length);
    expect(r.score).toBe(tokens.length * 3);
  });

  it('标签互相包含计命中（token 含于 tag 或 tag 含于 token）', () => {
    const tokens = tokenize('网络');
    expect(scoreSegment(tokens, T('x', 'y', ['计算机网络'])).tagHits).toBe(1);
  });
});
