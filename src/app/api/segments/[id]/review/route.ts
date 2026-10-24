import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { reviewLogs, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { review, type Grade } from '@/lib/sm2';


/** 提交一次复习评分（0 忘记 / 1 困难 / 2 良好 / 3 简单），按 SM-2 推进计划 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const { grade } = (await req.json().catch(() => ({}))) as { grade?: number };
  if (![0, 1, 2, 3].includes(grade ?? -1)) return badRequest('grade 必须是 0/1/2/3');
  const g = grade as Grade;

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const next = review(
    { ease: seg.ease, intervalDays: seg.intervalDays, reps: seg.reps, lapses: seg.lapses },
    g,
  );

  await db
    .update(segments)
    .set({
      ease: next.ease,
      intervalDays: next.intervalDays,
      reps: next.reps,
      lapses: next.lapses,
      lastGrade: g,
      dueAt: next.dueAt,
      mastery: next.mastery,
      status: next.status,
      lastViewedAt: new Date(),
    })
    .where(eq(segments.id, id));

  await db.insert(reviewLogs).values({
    segmentId: id,
    grade: g,
    prevIntervalDays: seg.intervalDays,
    nextIntervalDays: next.intervalDays,
  });

  return NextResponse.json({
    dueAt: next.dueAt,
    intervalDays: next.intervalDays,
    mastery: next.mastery,
    status: next.status,
  });
}
