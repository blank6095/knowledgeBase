import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, reviewLogs, segments } from '@/db/schema';
import { guard } from '@/lib/api';


/** 概览统计：总数/状态分布/建议回看/今日已学习/最近导入 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byStatus, dueRow, todayRow, recentDocs] = await Promise.all([
    db
      .select({ status: segments.status, count: sql<number>`count(*)::int` })
      .from(segments)
      .groupBy(segments.status),
    db.select({ count: sql<number>`count(*)::int` }).from(segments).where(lte(segments.dueAt, sql`now()`)),
    db.select({ count: sql<number>`count(*)::int` }).from(reviewLogs).where(lte(sql`${startOfDay.toISOString()}::timestamptz`, reviewLogs.reviewedAt)),
    db
      .select({ id: documents.id, title: documents.title, segmentCount: documents.segmentCount, createdAt: documents.createdAt })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(5),
  ]);

  const statusCount: Record<string, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  let total = 0;
  for (const row of byStatus) {
    statusCount[row.status] = row.count;
    total += row.count;
  }
  void eq;

  return NextResponse.json({
    total,
    byStatus: statusCount,
    suggestCount: dueRow[0]?.count ?? 0,
    learnedToday: todayRow[0]?.count ?? 0,
    recentDocuments: recentDocs,
  });
}
