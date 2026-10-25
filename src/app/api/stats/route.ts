import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, gte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, readingEvents, segments } from '@/db/schema';
import { guard } from '@/lib/api';
import { MEMORY_TIER_ORDER } from '@/lib/memory';


/** 概览统计：总数/记忆档位分布（SQL CASE 下推，单行返回）/今日阅读数/最近导入/今日首推（薄弱×中心性，纯规则不调 LLM） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const t0 = performance.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // 记忆度表达式与 src/lib/memory.ts memoryOf/memoryTier 一致：unread=M0 / weak<0.4 / medium<0.75 / strong≥0.75
  const m = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
  const read = sql`${segments.stability} > 0 and ${segments.lastViewedAt} is not null`;

  // L3-4 今日首推：已读但记忆薄弱（m<0.4）的段里，按 薄弱程度(1-m) × 图谱中心性(度数+1) 取 top1
  const suggestPromise = db
    .select({
      id: segments.id,
      title: segments.title,
      memory: sql<number>`(${m})::float`,
      degree: sql<number>`count(${links.id})::int`,
    })
    .from(segments)
    .leftJoin(links, or(eq(links.fromId, segments.id), eq(links.toId, segments.id)))
    .where(sql`${read} and (${m}) < 0.4`)
    .groupBy(segments.id, segments.title, segments.lastViewedAt, segments.stability)
    .orderBy(desc(sql`(1 - (${m})) * (count(${links.id}) + 1)`))
    .limit(1)
    .catch(() => []);

  const [tierRow, todayRow, recentDocs, suggestRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where not (${read}))::int`,
        weak: sql<number>`count(*) filter (where ${read} and ${m} < 0.4)::int`,
        medium: sql<number>`count(*) filter (where ${read} and ${m} >= 0.4 and ${m} < 0.75)::int`,
        strong: sql<number>`count(*) filter (where ${read} and ${m} >= 0.75)::int`,
      })
      .from(segments),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(readingEvents)
      .where(gte(readingEvents.startedAt, startOfDay)),
    db
      .select({ id: documents.id, title: documents.title, segmentCount: documents.segmentCount, createdAt: documents.createdAt })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(5),
    suggestPromise,
  ]);
  const tDb = performance.now();

  const suggest = suggestRows[0]
    ? { segmentId: suggestRows[0].id, title: suggestRows[0].title, memory: Math.round(suggestRows[0].memory * 100) / 100, degree: suggestRows[0].degree }
    : null;

  const payload = {
    total: tierRow[0]?.total ?? 0,
    byTier: {
      unread: tierRow[0]?.unread ?? 0,
      weak: tierRow[0]?.weak ?? 0,
      medium: tierRow[0]?.medium ?? 0,
      strong: tierRow[0]?.strong ?? 0,
    },
    tierOrder: MEMORY_TIER_ORDER,
    readToday: todayRow[0]?.count ?? 0,
    recentDocuments: recentDocs,
    suggestion: suggest,
  };
  const t1 = performance.now();
  console.log(
    `[perf] GET /api/stats db=${(tDb - t0).toFixed(1)}ms transform=${(t1 - tDb).toFixed(1)}ms total=${(t1 - t0).toFixed(1)}ms aggRows=1`,
  );

  const res = NextResponse.json(payload);
  res.headers.set(
    'Server-Timing',
    `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
  );
  return res;
}
