import { NextRequest, NextResponse } from 'next/server';
import { asc, desc, eq, gte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, readingEvents, segments } from '@/db/schema';
import { guard } from '@/lib/api';
import { getCache, setCache } from '@/lib/cache';
import { MEMORY_TIER_ORDER, type MemoryTier } from '@/lib/memory';

const CACHE_KEY = 'stats';
const CACHE_TTL_MS = 60_000;

type RecentDocument = Pick<typeof documents.$inferSelect, 'id' | 'title' | 'segmentCount' | 'createdAt'>;

interface StatsPayload {
  total: number;
  byTier: { unread: number; weak: number; medium: number; strong: number };
  tierOrder: MemoryTier[];
  readToday: number;
  recentDocuments: RecentDocument[];
  suggestion: { segmentId: string; title: string; memory: number; degree: number } | null;
  /** 与 suggestion 同一条 SQL：已读且记忆薄弱（m<0.4）按 薄弱度×(度数+1) 取 top3 */
  weakTop3: { segmentId: string; title: string; memory: number; degree: number }[];
  /** 最新导入且未读的段落 top3（文档创建时间倒序、段内顺序正序） */
  unreadTop3: { segmentId: string; title: string; documentId: string; documentTitle: string; createdAt: string | Date }[];
}

/** 概览统计：总数/记忆档位分布（SQL CASE 下推，单行返回）/今日阅读数/最近导入/今日首推（薄弱×中心性，纯规则不调 LLM） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  // 命中缓存时跳过全部 DB；不能用 miss 分支的耗时统计，命中时只报 cache 段
  const cached = getCache<StatsPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT', 'Server-Timing': 'cache;dur=0' } });
  }

  const t0 = performance.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // 记忆度表达式与 src/lib/memory.ts memoryOf/memoryTier 一致：unread=M0 / weak<0.4 / medium<0.75 / strong≥0.75
  const m = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
  const read = sql`${segments.stability} > 0 and ${segments.lastViewedAt} is not null`;

  // 今日首推与薄弱清单共用一条 SQL：已读但记忆薄弱（m<0.4）的段里，
  // 按 薄弱程度(1-m) × 图谱中心性(度数+1) 排序；suggestion 取第一行，weakTop3 取前三行。
  const weakPromise = db
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
    .limit(3)
    .catch(() => []);

  // 未读精选：最新导入且未读的段，按文档创建时间倒序、段内顺序正序取前三。
  const unreadPromise = db
    .select({
      segmentId: segments.id,
      title: segments.title,
      documentId: documents.id,
      documentTitle: documents.title,
      createdAt: documents.createdAt,
    })
    .from(segments)
    .innerJoin(documents, eq(segments.documentId, documents.id))
    .where(sql`not (${read})`)
    .orderBy(desc(documents.createdAt), asc(segments.orderIndex))
    .limit(3)
    .catch(() => []);

  const [tierRow, todayRow, recentDocs, weakRows, unreadRows] = await Promise.all([
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
    weakPromise,
    unreadPromise,
  ]);
  const tDb = performance.now();

  const weakTop3 = weakRows.map((row) => ({
    segmentId: row.id,
    title: row.title,
    memory: Math.round(row.memory * 100) / 100,
    degree: row.degree,
  }));
  const unreadTop3 = unreadRows.map((row) => ({
    segmentId: row.segmentId,
    title: row.title,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    createdAt: row.createdAt,
  }));

  const payload: StatsPayload = {
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
    suggestion: weakTop3[0] ?? null,
    weakTop3,
    unreadTop3,
  };
  const t1 = performance.now();
  console.log(
    `[perf] GET /api/stats db=${(tDb - t0).toFixed(1)}ms transform=${(t1 - tDb).toFixed(1)}ms total=${(t1 - t0).toFixed(1)}ms aggRows=1`,
  );

  setCache(CACHE_KEY, payload, CACHE_TTL_MS);

  const res = NextResponse.json(payload);
  res.headers.set('X-Cache', 'MISS');
  res.headers.set(
    'Server-Timing',
    `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
  );
  return res;
}
