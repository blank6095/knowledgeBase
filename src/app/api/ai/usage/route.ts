import { NextRequest, NextResponse } from 'next/server';
import { and, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { llmCalls } from '@/db/schema';
import { guard } from '@/lib/api';

/** 日 token 护栏（docs/llm-optimization-plan.md 建议值，接近日志后校准） */
export const DAILY_TOKEN_GUARDRAIL = 500_000;

/**
 * 大模型用量（近 7 天，设置页可观测小节）：
 * 按日聚合（调用数/输入/输出 token/缓存命中）、按 kind 汇总、今日用量 vs 护栏。
 * preview 缓存命中率 = split/aggregate 的 cached 行 / 该两类总行数。
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byDay, byKind, todayRow] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${llmCalls.createdAt}::date, 'YYYY-MM-DD')`,
        calls: sql<number>`count(*)::int`,
        cachedHits: sql<number>`count(*) filter (where ${llmCalls.cached} = 1)::int`,
        inTok: sql<number>`coalesce(sum(${llmCalls.inTok}), 0)::int`,
        outTok: sql<number>`coalesce(sum(${llmCalls.outTok}), 0)::int`,
        errors: sql<number>`count(*) filter (where ${llmCalls.error} is not null)::int`,
        avgMs: sql<number>`coalesce(avg(${llmCalls.ms}) filter (where ${llmCalls.cached} = 0), 0)::int`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, since))
      .groupBy(sql`${llmCalls.createdAt}::date`)
      .orderBy(sql`${llmCalls.createdAt}::date desc`),
    db
      .select({
        kind: llmCalls.kind,
        calls: sql<number>`count(*)::int`,
        cachedHits: sql<number>`count(*) filter (where ${llmCalls.cached} = 1)::int`,
        inTok: sql<number>`coalesce(sum(${llmCalls.inTok}), 0)::int`,
        outTok: sql<number>`coalesce(sum(${llmCalls.outTok}), 0)::int`,
      })
      .from(llmCalls)
      .where(and(gte(llmCalls.createdAt, since), inArray(llmCalls.kind, ['split', 'aggregate'])))
      .groupBy(llmCalls.kind),
    db
      .select({
        calls: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${llmCalls.inTok} + ${llmCalls.outTok}), 0)::int`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, startOfDay)),
  ]);

  const previewTotal = byKind.reduce((s, r) => s + r.calls, 0);
  const previewHits = byKind.reduce((s, r) => s + r.cachedHits, 0);

  return NextResponse.json({
    days: byDay,
    byKind,
    today: { calls: todayRow[0]?.calls ?? 0, tokens: todayRow[0]?.tokens ?? 0, guardrail: DAILY_TOKEN_GUARDRAIL },
    previewHitRate: previewTotal > 0 ? Math.round((previewHits / previewTotal) * 100) : null,
  });
}
