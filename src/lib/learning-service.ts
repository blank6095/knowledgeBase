import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, recallReviews, segments } from '@/db/schema';
import {
  computeWeeklyMetrics,
  recommendLearningItems,
  type LearningCandidate,
  type RecallResult,
  type ReviewSnapshot,
  type TodayLearningItem,
  type WeeklyLearningMetrics,
} from '@/lib/learning-plan';
import { memoryOf } from '@/lib/memory';

export interface TodayLearningPayload {
  items: TodayLearningItem[];
  metrics: WeeklyLearningMetrics;
  generatedAt: Date;
}

export async function getTodayLearning(now = new Date()): Promise<TodayLearningPayload> {
  const [segmentRows, reviewRows] = await Promise.all([
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
    db
      .select({
        segmentId: recallReviews.segmentId,
        result: recallReviews.result,
        reviewedAt: recallReviews.reviewedAt,
        nextReviewAt: recallReviews.nextReviewAt,
      })
      .from(recallReviews),
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
