import { NextRequest, NextResponse } from 'next/server';
import { desc, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, readingEvents, segments } from '@/db/schema';
import { guard } from '@/lib/api';
import { memoryOf, memoryTier, MEMORY_TIER_ORDER } from '@/lib/memory';


/** 概览统计：总数/记忆档位分布/今日阅读数/最近导入 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [segs, todayRow, recentDocs] = await Promise.all([
    db.select({ stability: segments.stability, lastViewedAt: segments.lastViewedAt }).from(segments),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(readingEvents)
      .where(gte(readingEvents.startedAt, startOfDay)),
    db
      .select({ id: documents.id, title: documents.title, segmentCount: documents.segmentCount, createdAt: documents.createdAt })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(5),
  ]);

  const byTier: Record<string, number> = { unread: 0, weak: 0, medium: 0, strong: 0 };
  const now = new Date();
  for (const s of segs) {
    byTier[memoryTier(memoryOf(s.stability, s.lastViewedAt, now))] += 1;
  }

  return NextResponse.json({
    total: segs.length,
    byTier,
    tierOrder: MEMORY_TIER_ORDER,
    readToday: todayRow[0]?.count ?? 0,
    recentDocuments: recentDocs,
  });
}
