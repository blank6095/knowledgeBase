import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';


/** 知识点详情：内容 + 复习状态 + 双向关联 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const [doc] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(eq(documents.id, seg.documentId));

  const edges = await db
    .select({ fromId: links.fromId, toId: links.toId, kind: links.kind, weight: links.weight })
    .from(links)
    .where(or(eq(links.fromId, id), eq(links.toId, id)));

  const otherIds = [...new Set(edges.map((e) => (e.fromId === id ? e.toId : e.fromId)))];
  const neighbors = otherIds.length
    ? await db
        .select({ id: segments.id, title: segments.title, mastery: segments.mastery, status: segments.status })
        .from(segments)
        .where(inArray(segments.id, otherIds))
    : [];

  return NextResponse.json({ segment: seg, document: doc ?? null, links: edges, neighbors });
}
