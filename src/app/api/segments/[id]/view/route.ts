import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { reviewLogs, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { touch } from '@/lib/sm2';

/**
 * 打开即学习：每次打开 viewCount+1 并刷新查看时间；
 * 当日首次打开（更新前 lastViewedAt 不在今日）按 SM-2 grade=2 隐式推进
 * mastery/status/dueAt 并写 review_logs(grade=2) 作为学习事件流水；
 * 当日重复打开只记查看，不推进、不写流水。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const now = new Date();
  const advanced = touch(
    { ease: seg.ease, intervalDays: seg.intervalDays, reps: seg.reps, lapses: seg.lapses },
    seg.lastViewedAt,
    now,
  );

  const viewUpdate = {
    viewCount: sql`${segments.viewCount} + 1`,
    firstViewedAt: sql`coalesce(${segments.firstViewedAt}, ${now.toISOString()}::timestamptz)`,
    lastViewedAt: now,
  };

  if (advanced) {
    await db
      .update(segments)
      .set({
        ...viewUpdate,
        ease: advanced.ease,
        intervalDays: advanced.intervalDays,
        reps: advanced.reps,
        lapses: advanced.lapses,
        lastGrade: 2,
        dueAt: advanced.dueAt,
        mastery: advanced.mastery,
        status: advanced.status,
      })
      .where(eq(segments.id, id));
    await db.insert(reviewLogs).values({
      segmentId: id,
      grade: 2,
      prevIntervalDays: seg.intervalDays,
      nextIntervalDays: advanced.intervalDays,
    });
  } else {
    await db.update(segments).set(viewUpdate).where(eq(segments.id, id));
  }

  return NextResponse.json({
    ok: true,
    advanced: advanced !== null,
    mastery: advanced?.mastery ?? seg.mastery,
    status: advanced?.status ?? seg.status,
  });
}
