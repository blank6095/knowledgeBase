import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';


/** 记录一次查看：次数 +1，刷新首次/最近查看时间 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const now = new Date();
  const [updated] = await db
    .update(segments)
    .set({
      viewCount: sql`${segments.viewCount} + 1`,
      firstViewedAt: sql`coalesce(${segments.firstViewedAt}, ${now.toISOString()}::timestamptz)`,
      lastViewedAt: now,
    })
    .where(eq(segments.id, id))
    .returning({ viewCount: segments.viewCount });
  if (!updated) return notFound('知识点不存在');
  return NextResponse.json({ ok: true, viewCount: updated.viewCount });
}
