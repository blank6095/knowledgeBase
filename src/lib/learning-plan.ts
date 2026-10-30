import { createHash } from 'node:crypto';

export type RecallResult = 'incorrect' | 'partial' | 'correct';
export type LearningReasonCode = 'previous-incorrect' | 'due-review' | 'continue-learning' | 'new-knowledge' | 'scheduled';

export const RECALL_RESULTS: RecallResult[] = ['incorrect', 'partial', 'correct'];

const REVIEW_DELAY_DAYS: Record<RecallResult, number> = {
  incorrect: 1,
  partial: 3,
  correct: 7,
};

export interface LearningCandidate {
  segmentId: string;
  title: string;
  documentId: string;
  documentTitle: string;
  memory: number;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
}

export interface ReviewSnapshot {
  segmentId: string;
  result: RecallResult;
  reviewedAt: Date;
  nextReviewAt: Date | null;
}

export interface TodayLearningItem extends LearningCandidate {
  reasonCode: LearningReasonCode;
  reason: string;
  latestResult: RecallResult | null;
  nextReviewAt: Date | null;
}

export interface WeeklyLearningMetrics {
  reviewCount: number;
  needsReviewCount: number;
  improvedCount: number;
  activeDays: number;
}

export function isRecallResult(value: unknown): value is RecallResult {
  return typeof value === 'string' && RECALL_RESULTS.includes(value as RecallResult);
}

export function nextReviewAt(result: RecallResult, from = new Date()): Date {
  return new Date(from.getTime() + REVIEW_DELAY_DAYS[result] * 24 * 60 * 60 * 1_000);
}

/** 题目与复习记录共用同一内容版本；标题或正文任一变化都会使旧题失效。 */
export function sourceVersion(title: string, content: string): string {
  return createHash('sha256').update(`${title}\n\0\n${content}`).digest('hex');
}

function latestReviewMap(reviews: ReviewSnapshot[]): Map<string, ReviewSnapshot> {
  const latest = new Map<string, ReviewSnapshot>();
  for (const review of reviews) {
    const current = latest.get(review.segmentId);
    if (!current || review.reviewedAt.getTime() > current.reviewedAt.getTime()) {
      latest.set(review.segmentId, review);
    }
  }
  return latest;
}

const REASON_META: Record<LearningReasonCode, { priority: number; label: string }> = {
  'previous-incorrect': { priority: 0, label: '上次没有答出' },
  'due-review': { priority: 1, label: '复习已到期' },
  'continue-learning': { priority: 2, label: '最近读过，尚未自测' },
  'new-knowledge': { priority: 3, label: '尚未开始学习' },
  scheduled: { priority: 4, label: '已安排后续复习' },
};

function reasonFor(candidate: LearningCandidate, review: ReviewSnapshot | undefined, now: Date): LearningReasonCode {
  if (review?.result === 'incorrect') return 'previous-incorrect';
  if (review && (!review.nextReviewAt || review.nextReviewAt.getTime() <= now.getTime())) return 'due-review';
  if (!review && candidate.viewCount > 0) return 'continue-learning';
  if (!review) return 'new-knowledge';
  return 'scheduled';
}

function timestamp(value: Date | null): number {
  return value?.getTime() ?? 0;
}

/**
 * 确定性推荐：先分类，再在类内按可解释字段排序。
 * 分类优先级固定，不把多种因素揉成难以解释的综合分数。
 */
export function recommendLearningItems(
  candidates: LearningCandidate[],
  reviews: ReviewSnapshot[],
  now = new Date(),
  limit = 3,
): TodayLearningItem[] {
  const latest = latestReviewMap(reviews);
  return candidates
    .map((candidate) => {
      const review = latest.get(candidate.segmentId);
      const reasonCode = reasonFor(candidate, review, now);
      return {
        ...candidate,
        reasonCode,
        reason: REASON_META[reasonCode].label,
        latestResult: review?.result ?? null,
        nextReviewAt: review?.nextReviewAt ?? null,
      };
    })
    .filter((item) => item.reasonCode !== 'scheduled')
    .sort((a, b) => {
      const priority = REASON_META[a.reasonCode].priority - REASON_META[b.reasonCode].priority;
      if (priority !== 0) return priority;

      if (a.reasonCode === 'previous-incorrect') {
        return timestamp(latest.get(b.segmentId)?.reviewedAt ?? null) - timestamp(latest.get(a.segmentId)?.reviewedAt ?? null);
      }
      if (a.reasonCode === 'due-review' || a.reasonCode === 'scheduled') {
        return timestamp(a.nextReviewAt) - timestamp(b.nextReviewAt);
      }
      if (a.reasonCode === 'continue-learning') {
        return timestamp(b.lastViewedAt) - timestamp(a.lastViewedAt);
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, Math.max(0, limit));
}

export function learningDayKey(date: Date, timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 最近 7 天滚动反馈；同一知识多次作答仍保留多条记录，但“改善”按知识去重。 */
export function computeWeeklyMetrics(
  reviews: ReviewSnapshot[],
  now = new Date(),
  timeZone = 'Asia/Shanghai',
): WeeklyLearningMetrics {
  const start = now.getTime() - 7 * 24 * 60 * 60 * 1_000;
  const current = reviews.filter((review) => review.reviewedAt.getTime() >= start && review.reviewedAt.getTime() <= now.getTime());
  const activeDays = new Set(current.map((review) => learningDayKey(review.reviewedAt, timeZone))).size;
  const needsReviewCount = current.filter((review) => review.result !== 'correct').length;

  const improved = new Set<string>();
  for (const review of current) {
    if (review.result === 'incorrect') continue;
    const previousIncorrect = reviews.some(
      (other) =>
        other.segmentId === review.segmentId &&
        other.result === 'incorrect' &&
        other.reviewedAt.getTime() < review.reviewedAt.getTime(),
    );
    if (previousIncorrect) improved.add(review.segmentId);
  }

  return {
    reviewCount: current.length,
    needsReviewCount,
    improvedCount: improved.size,
    activeDays,
  };
}
