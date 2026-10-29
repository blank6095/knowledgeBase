import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { extractInlineTags } from '@/lib/markdown';
import { invalidateCache } from '@/lib/cache';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries, rebuildLinksQueries } from '@/lib/links';

/** 在文档中插入知识点：afterIndex 为插入位置（新段的序号），缺省追加到末尾 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, id));
  if (!doc) return notFound('文档不存在');

  const body = (await req.json().catch(() => ({}))) as { afterIndex?: unknown; title?: string; content?: string };
  if (
    body.afterIndex !== undefined &&
    (typeof body.afterIndex !== 'number' || !Number.isInteger(body.afterIndex) || body.afterIndex < 0)
  ) {
    return badRequest('afterIndex 必须是非负整数');
  }
  const title = (typeof body.title === 'string' ? body.title : '').trim() || '新知识点';
  const content = typeof body.content === 'string' ? body.content : '';

  const existing = await db
    .select({ orderIndex: segments.orderIndex })
    .from(segments)
    .where(eq(segments.documentId, id))
    .orderBy(asc(segments.orderIndex));
  const n = existing.length;
  const pos = Math.min(body.afterIndex ?? n, n);

  const segmentId = randomUUID();
  const segTags = extractInlineTags(content).slice(0, 20);
  await runBatch([
    ...(pos < n
      ? [
          db
            .update(segments)
            .set({ orderIndex: sql`${segments.orderIndex} + 1` })
            .where(and(eq(segments.documentId, id), gte(segments.orderIndex, pos))),
        ]
      : []),
    db.insert(segments).values({
      id: segmentId,
      documentId: id,
      title: title.slice(0, 200),
      content,
      headingPath: title.slice(0, 300),
      orderIndex: pos,
      tags: segTags,
    }),
    ...rebuildLinksQueries([segmentId]),
    ...rebuildDocQueries(id),
  ]);

  // 新增段会同时改变图谱边、概览统计、文档列表段数与详情
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${id}`);

  return NextResponse.json({ segment: { id: segmentId, orderIndex: pos } });
}
