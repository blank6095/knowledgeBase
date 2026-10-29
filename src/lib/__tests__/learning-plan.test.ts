import { describe, expect, it } from 'vitest';
import {
  computeWeeklyMetrics,
  nextReviewAt,
  recommendLearningItems,
  sourceVersion,
  type LearningCandidate,
  type ReviewSnapshot,
} from '../learning-plan';

const NOW = new Date('2026-10-29T08:00:00.000Z');

function candidate(id: string, overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    segmentId: id,
    title: id,
    documentId: `doc-${id}`,
    documentTitle: '文档',
    memory: 0.5,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
    ...overrides,
  };
}

function review(
  segmentId: string,
  result: ReviewSnapshot['result'],
  reviewedAt: string,
  next: string | null,
): ReviewSnapshot {
  return {
    segmentId,
    result,
    reviewedAt: new Date(reviewedAt),
    nextReviewAt: next ? new Date(next) : null,
  };
}

describe('sourceVersion', () => {
  it('标题或正文变化会改变内容版本', () => {
    expect(sourceVersion('A', '正文')).toBe(sourceVersion('A', '正文'));
    expect(sourceVersion('A', '正文')).not.toBe(sourceVersion('A2', '正文'));
    expect(sourceVersion('A', '正文')).not.toBe(sourceVersion('A', '正文2'));
  });
});

describe('nextReviewAt', () => {
  it.each([
    ['incorrect', 1],
    ['partial', 3],
    ['correct', 7],
  ] as const)('%s 延后 %s 天', (result, days) => {
    expect(nextReviewAt(result, NOW).toISOString()).toBe(
      new Date(NOW.getTime() + days * 24 * 3600_000).toISOString(),
    );
  });
});

describe('recommendLearningItems', () => {
  it('严格按错题、到期、继续、未读排序并去重', () => {
    const candidates = [
      candidate('wrong'),
      candidate('due'),
      candidate('continue', { viewCount: 2, lastViewedAt: new Date('2026-10-28T00:00:00.000Z') }),
      candidate('new', { createdAt: new Date('2026-10-27T00:00:00.000Z') }),
    ];
    const reviews = [
      review('wrong', 'incorrect', '2026-10-28T00:00:00.000Z', '2026-10-30T00:00:00.000Z'),
      review('wrong', 'partial', '2026-10-20T00:00:00.000Z', '2026-10-23T00:00:00.000Z'),
      review('due', 'correct', '2026-10-20T00:00:00.000Z', '2026-10-27T00:00:00.000Z'),
    ];
    const items = recommendLearningItems(candidates, reviews, NOW, 4);
    expect(items.map((item) => item.segmentId)).toEqual(['wrong', 'due', 'continue', 'new']);
    expect(items.map((item) => item.reasonCode)).toEqual([
      'previous-incorrect',
      'due-review',
      'continue-learning',
      'new-knowledge',
    ]);
  });

  it('无复习历史时仍可推荐', () => {
    const items = recommendLearningItems([candidate('a', { viewCount: 1 })], [], NOW);
    expect(items[0]).toMatchObject({ segmentId: 'a', reasonCode: 'continue-learning' });
  });

  it('未来已安排复习的知识不提前出现在今日推荐中', () => {
    const items = recommendLearningItems(
      [candidate('future'), candidate('new')],
      [review('future', 'correct', '2026-10-28T00:00:00.000Z', '2026-11-04T00:00:00.000Z')],
      NOW,
      2,
    );
    expect(items.map((item) => item.segmentId)).toEqual(['new']);
  });
});

describe('computeWeeklyMetrics', () => {
  it('统计近 7 天练习、薄弱、改善与活跃天数', () => {
    const reviews = [
      review('a', 'incorrect', '2026-10-23T08:00:00.000Z', null),
      review('a', 'correct', '2026-10-27T08:00:00.000Z', null),
      review('b', 'partial', '2026-10-27T10:00:00.000Z', null),
      review('c', 'incorrect', '2026-10-20T08:00:00.000Z', null),
    ];
    expect(computeWeeklyMetrics(reviews, NOW)).toEqual({
      reviewCount: 3,
      needsReviewCount: 2,
      improvedCount: 1,
      activeDays: 2,
    });
  });

  it('无数据时返回全零而不是伪造掌握率', () => {
    expect(computeWeeklyMetrics([], NOW)).toEqual({
      reviewCount: 0,
      needsReviewCount: 0,
      improvedCount: 0,
      activeDays: 0,
    });
  });
});
