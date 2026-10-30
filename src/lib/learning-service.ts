import { desc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { documents, readingEvents, recallReviews, segments } from '@/db/schema';
import {
  computeWeeklyMetrics,
  learningDayKey,
  recommendLearningItems,
  type LearningCandidate,
  type RecallResult,
  type ReviewSnapshot,
  type TodayLearningItem,
  type WeeklyLearningMetrics,
} from '@/lib/learning-plan';
import { memoryOf } from '@/lib/memory';
import { withDbRetry } from '@/lib/db-retry';

export interface TodayLearningPayload {
  items: TodayLearningItem[];
  metrics: WeeklyLearningMetrics;
  generatedAt: Date;
}

export interface DailyLearningActivity {
  day: string;
  reviews: number;
  readingSessions: number;
  readingMs: number;
  needsReview: number;
}

export interface WeeklyLearningReport {
  summary: string;
  current: WeeklyLearningMetrics;
  previous: WeeklyLearningMetrics;
  days: DailyLearningActivity[];
  priorityItems: TodayLearningItem[];
}

export async function getTodayLearning(now = new Date()): Promise<TodayLearningPayload> {
  const [segmentRows, reviewRows] = await Promise.all([
    withDbRetry(
      () =>
        db
          .select({
            segmentId: segments.id,
            title: segments.title,
            documentId: segments.documentId,
            documentTitle: documents.title,
            viewCount: segments.viewCount,
            stability: segments.stability,
            lastViewedAt: segments.lastViewedAt,
            createdAt: segments.createdAt,
          })
          .from(segments)
          .leftJoin(documents, eq(segments.documentId, documents.id)),
      { label: 'learning.segments' },
    ),
    withDbRetry(
      () =>
        db
          .select({
            segmentId: recallReviews.segmentId,
            result: recallReviews.result,
            reviewedAt: recallReviews.reviewedAt,
            nextReviewAt: recallReviews.nextReviewAt,
          })
          .from(recallReviews),
      { label: 'learning.reviews' },
    ),
  ]);

  const candidates: LearningCandidate[] = segmentRows.map((row) => ({
    segmentId: row.segmentId,
    title: row.title,
    documentId: row.documentId,
    documentTitle: row.documentTitle ?? '未知文档',
    memory: memoryOf(row.stability, row.lastViewedAt, now),
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt,
    createdAt: row.createdAt,
  }));
  const reviews: ReviewSnapshot[] = reviewRows.map((row) => ({
    segmentId: row.segmentId,
    result: row.result as RecallResult,
    reviewedAt: row.reviewedAt,
    nextReviewAt: row.nextReviewAt,
  }));

  return {
    items: recommendLearningItems(candidates, reviews, now),
    metrics: computeWeeklyMetrics(reviews, now),
    generatedAt: now,
  };
}

export async function getWeeklyLearningReport(now = new Date()): Promise<WeeklyLearningReport> {
  const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1_000);
  const [reviewRows, readingRows, today] = await Promise.all([
    withDbRetry(
      () =>
        db
          .select({
            segmentId: recallReviews.segmentId,
            result: recallReviews.result,
            reviewedAt: recallReviews.reviewedAt,
            nextReviewAt: recallReviews.nextReviewAt,
          })
          .from(recallReviews)
          .orderBy(desc(recallReviews.reviewedAt)),
      { label: 'weekly.reviews' },
    ),
    withDbRetry(
      () =>
        db
          .select({
            segmentId: readingEvents.segmentId,
            startedAt: readingEvents.startedAt,
            durationMs: readingEvents.durationMs,
          })
          .from(readingEvents)
          .where(gte(readingEvents.startedAt, start)),
      { label: 'weekly.readings' },
    ),
    getTodayLearning(now),
  ]);

  const reviews: ReviewSnapshot[] = reviewRows.map((row) => ({
    segmentId: row.segmentId,
    result: row.result as RecallResult,
    reviewedAt: row.reviewedAt,
    nextReviewAt: row.nextReviewAt,
  }));
  const current = computeWeeklyMetrics(reviews, now);
  const previous = computeWeeklyMetrics(reviews, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000));
  const days: DailyLearningActivity[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1_000);
    const day = learningDayKey(date);
    const dayReviews = reviews.filter((review) => learningDayKey(review.reviewedAt) === day);
    const dayReadings = readingRows.filter((event) => learningDayKey(event.startedAt) === day);
    days.push({
      day,
      reviews: dayReviews.length,
      readingSessions: dayReadings.length,
      readingMs: dayReadings.reduce((sum, event) => sum + event.durationMs, 0),
      needsReview: dayReviews.filter((review) => review.result !== 'correct').length,
    });
  }

  return {
    summary:
      current.reviewCount === 0
        ? '近 7 天还没有主动回忆记录。先完成一次自测，比继续增加阅读量更能暴露真实掌握情况。'
        : `近 7 天完成 ${current.reviewCount} 次主动回忆，其中 ${current.needsReviewCount} 次需要继续巩固；${current.improvedCount} 个知识点较此前有改善，活跃 ${current.activeDays} 天。`,
    current,
    previous,
    days,
    priorityItems: today.items,
  };
}
