import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { memoryOf } from '@/lib/memory';


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return notFound('文档不存在');

  const now = new Date();
  const segs = await db
    .select({
      id: segments.id,
      title: segments.title,
      headingPath: segments.headingPath,
      tags: segments.tags,
      viewCount: segments.viewCount,
      stability: segments.stability,
      lastViewedAt: segments.lastViewedAt,
    })
    .from(segments)
    .where(eq(segments.documentId, id))
    .orderBy(asc(segments.orderIndex));

  return NextResponse.json({
    document: doc,
    segments: segs.map((s) => ({
      id: s.id,
      title: s.title,
      headingPath: s.headingPath,
      tags: s.tags,
      viewCount: s.viewCount,
      memory: memoryOf(s.stability, s.lastViewedAt, now),
    })),
  });
}
