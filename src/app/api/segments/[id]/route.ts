import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { halfLifeDays, memoryOf } from '@/lib/memory';


/** 知识点详情：内容 + 阅读状态（记忆度现算）+ 双向关联 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const now = new Date();
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
  const neighborRows = otherIds.length
    ? await db
        .select({ id: segments.id, title: segments.title, stability: segments.stability, lastViewedAt: segments.lastViewedAt })
        .from(segments)
        .where(inArray(segments.id, otherIds))
    : [];

  const neighbors = neighborRows.map((n) => ({
    id: n.id,
    title: n.title,
    memory: memoryOf(n.stability, n.lastViewedAt, now),
  }));

  return NextResponse.json({
    segment: {
      id: seg.id,
      title: seg.title,
      content: seg.content,
      headingPath: seg.headingPath,
      tags: seg.tags,
      viewCount: seg.viewCount,
      firstViewedAt: seg.firstViewedAt,
      lastViewedAt: seg.lastViewedAt,
      stability: seg.stability,
      readingMs: Number(seg.readingMs),
      memory: memoryOf(seg.stability, seg.lastViewedAt, now),
      halfLifeDays: halfLifeDays(seg.stability),
    },
    document: doc ?? null,
    links: edges,
    neighbors,
  });
}
