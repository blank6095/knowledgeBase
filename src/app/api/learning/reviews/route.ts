import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { recallReviews, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import {
  isRecallResult,
  nextReviewAt,
  sourceVersion,
  type RecallResult,
} from '@/lib/learning-plan';

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : '';
  const segmentId = typeof body.segmentId === 'string' ? body.segmentId : '';
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 800) : '';
  const referenceAnswer =
    typeof body.referenceAnswer === 'string' ? body.referenceAnswer.trim().slice(0, 4_000) : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 4_000) : '';
  const version = typeof body.sourceVersion === 'string' ? body.sourceVersion : '';

  if (!isUuid(submissionId)) return badRequest('submissionId 无效');
  if (!isUuid(segmentId)) return badRequest('segmentId 无效');
  if (!question || !referenceAnswer) return badRequest('题目或参考答案为空');
  if (!isRecallResult(body.result)) return badRequest('result 必须是 incorrect/partial/correct');
  if (body.result !== 'incorrect' && !answer) return badRequest('请先写下回答，再记录掌握结果');
  if (!/^[0-9a-f]{64}$/i.test(version)) return badRequest('sourceVersion 无效');

  const [existing] = await db
    .select()
    .from(recallReviews)
    .where(eq(recallReviews.submissionId, submissionId));
  if (existing) {
    return NextResponse.json({ review: existing, duplicate: true });
  }

  const [segment] = await db
    .select({ id: segments.id, title: segments.title, content: segments.content })
    .from(segments)
    .where(eq(segments.id, segmentId));
  if (!segment) return notFound('知识点不存在');
  if (sourceVersion(segment.title, segment.content) !== version) {
    return NextResponse.json({ error: '知识内容已变化，请重新生成题目后再提交' }, { status: 409 });
  }

  const result = body.result as RecallResult;
  const reviewedAt = new Date();
  const next = nextReviewAt(result, reviewedAt);
  const values = {
    submissionId,
    segmentId,
    question,
    referenceAnswer,
    answer,
    result,
    sourceVersion: version,
    reviewedAt,
    nextReviewAt: next,
  };
  const [inserted] = await db.insert(recallReviews).values(values).onConflictDoNothing().returning();
  if (inserted) {
    invalidateCache('stats');
    return NextResponse.json({ review: inserted, duplicate: false });
  }

  const [raced] = await db
    .select()
    .from(recallReviews)
    .where(eq(recallReviews.submissionId, submissionId));
  if (!raced) return NextResponse.json({ error: '复习记录写入失败，请重试' }, { status: 500 });
  return NextResponse.json({ review: raced, duplicate: true });
}
