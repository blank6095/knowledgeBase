import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { readingEvents, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { applyReading, MEMORY } from '@/lib/memory';

/**
 * 阅读行为上报，两种调用形态：
 * - 打开 ping（无 body / durationMs 缺失）：仅 viewCount+1、补 firstViewedAt；
 * - 停留上报（durationMs，页面隐藏/卸载/离开时由 sendBeacon 发出）：
 *   ≥5 秒写 reading_events 流水并推进 stability、累计 readingMs、刷新 lastViewedAt；
 *   <5 秒不写事件、不推进（打开 ping 已计过 viewCount）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as { durationMs?: unknown };
  const durationMs = typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)
    ? Math.max(0, Math.round(body.durationMs))
    : null;

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const now = new Date();

  // 停留上报
  if (durationMs !== null) {
    const stability = applyReading(
      { stability: seg.stability, lastReadAt: seg.lastViewedAt },
      durationMs,
      now,
    );
    if (stability === null) return NextResponse.json({ ok: true, counted: false });

    const effectiveMs = Math.min(durationMs, MEMORY.MAX_SESSION_MS);
    await db.insert(readingEvents).values({
      segmentId: id,
      startedAt: new Date(now.getTime() - durationMs),
      durationMs,
    });
    await db
      .update(segments)
      .set({
        stability,
        readingMs: sql`${segments.readingMs} + ${effectiveMs}`,
        lastViewedAt: now,
      })
      .where(eq(segments.id, id));

    // 写库成功后才失效：记忆度/阅读时长变化影响图谱与概览
    invalidateCache('graph');
    invalidateCache('stats');

    return NextResponse.json({ ok: true, counted: true, stability });
  }

  // 打开 ping
  await db
    .update(segments)
    .set({
      viewCount: sql`${segments.viewCount} + 1`,
      firstViewedAt: sql`coalesce(${segments.firstViewedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(segments.id, id));

  // 打开 ping 已写 viewCount/firstViewedAt（durationMs 缺失或 <5s 未写库时提前返回）
  invalidateCache('graph');
  invalidateCache('stats');

  return NextResponse.json({ ok: true, counted: true });
}
