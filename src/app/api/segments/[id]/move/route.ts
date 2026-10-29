import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries } from '@/lib/links';

/** 与相邻段交换顺序（同文档内）：direction = up（向前）| down（向后） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as { direction?: 'up' | 'down' };
  if (body.direction !== 'up' && body.direction !== 'down') return badRequest('direction 必须是 up/down');

  const [seg] = await db
    .select({ id: segments.id, documentId: segments.documentId, orderIndex: segments.orderIndex })
    .from(segments)
    .where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const siblings = await db
    .select({ id: segments.id, orderIndex: segments.orderIndex })
    .from(segments)
    .where(eq(segments.documentId, seg.documentId))
    .orderBy(asc(segments.orderIndex));

  const cur = siblings.findIndex((s) => s.id === id);
  if (cur === -1) return notFound();
  const target = body.direction === 'up' ? cur - 1 : cur + 1;
  if (target < 0 || target >= siblings.length) return badRequest(body.direction === 'up' ? '已经是第一节' : '已经是最后一节');

  // 交换两者的 orderIndex，并在同一事务内重建文档链。
  await runBatch([
    db.update(segments).set({ orderIndex: siblings[target].orderIndex }).where(eq(segments.id, seg.id)),
    db.update(segments).set({ orderIndex: seg.orderIndex }).where(eq(segments.id, siblings[target].id)),
    ...rebuildDocQueries(seg.documentId),
  ]);

  // 顺序变化会重接 doc 边并影响列表/详情展示
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${seg.documentId}`);

  return NextResponse.json({ ok: true });
}
