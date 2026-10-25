import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { extractInlineTags } from '@/lib/markdown';
import { rebuildDocChain, rebuildSegmentLinks } from '@/lib/links';

/** 在文档中插入知识点：afterIndex 为插入位置（新段的序号），缺省追加到末尾 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, id));
  if (!doc) return notFound('文档不存在');

  const body = (await req.json().catch(() => ({}))) as { afterIndex?: number; title?: string; content?: string };
  const title = (body.title ?? '').trim() || '新知识点';
  const content = typeof body.content === 'string' ? body.content : '';

  const existing = await db
    .select({ orderIndex: segments.orderIndex })
    .from(segments)
    .where(eq(segments.documentId, id))
    .orderBy(asc(segments.orderIndex));
  const n = existing.length;
  const pos = Math.min(Math.max(0, body.afterIndex ?? n), n);

  // 腾位：pos 及之后的段序号 +1，再插入；rebuildDocChain 负责归一化与 doc 边重接
  if (pos < n) {
    await db
      .update(segments)
      .set({ orderIndex: sql`${segments.orderIndex} + 1` })
      .where(and(eq(segments.documentId, id), gte(segments.orderIndex, pos)));
  }
  const [seg] = await db
    .insert(segments)
    .values({
      documentId: id,
      title: title.slice(0, 200),
      content,
      headingPath: title.slice(0, 300),
      orderIndex: pos,
      tags: extractInlineTags(content).slice(0, 20),
    })
    .returning({ id: segments.id, orderIndex: segments.orderIndex });

  // 新段同样参与全库 wiki/tag 关联（与导入语义一致）
  const segTags = extractInlineTags(content).slice(0, 20);
  await rebuildSegmentLinks({ id: seg.id, content, tags: segTags });
  await rebuildDocChain(id);
  return NextResponse.json({ segment: seg });
}
