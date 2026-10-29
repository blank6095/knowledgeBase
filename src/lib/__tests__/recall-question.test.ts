import { describe, expect, it } from 'vitest';
import { fallbackRecallQuestion, normalizeRecallQuestion } from '../recall-question';

describe('normalizeRecallQuestion', () => {
  it('校验并截断题目与参考答案', () => {
    const result = normalizeRecallQuestion({
      question: `  ${'问'.repeat(900)}  `,
      referenceAnswer: `  ${'答'.repeat(5_000)}  `,
    });
    expect(result.question).toHaveLength(800);
    expect(result.referenceAnswer).toHaveLength(4_000);
    expect(result.question.startsWith('问')).toBe(true);
  });

  it('拒绝空题目和错误形状', () => {
    expect(() => normalizeRecallQuestion(null)).toThrow(/形状/);
    expect(() => normalizeRecallQuestion({ question: '', referenceAnswer: '答' })).toThrow(/为空/);
  });
});

describe('fallbackRecallQuestion', () => {
  it('无 LLM 时仍生成可追溯原文的复述题', () => {
    const result = fallbackRecallQuestion({
      id: 's1',
      title: 'HashMap',
      content: 'HashMap 使用数组、链表与红黑树处理冲突。',
      summary: null,
    });
    expect(result.question).toContain('HashMap');
    expect(result.referenceAnswer).toContain('红黑树');
    expect(result.sourceVersion).toMatch(/^[0-9a-f]{64}$/);
  });
});
