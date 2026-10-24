import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return notFound('文档不存在');

  const segs = await db
    .select({
      id: segments.id,
      title: segments.title,
      headingPath: segments.headingPath,
      tags: segments.tags,
      mastery: segments.mastery,
      status: segments.status,
      viewCount: segments.viewCount,
      dueAt: segments.dueAt,
    })
    .from(segments)
    .where(eq(segments.documentId, id))
    .orderBy(asc(segments.orderIndex));

  return NextResponse.json({ document: doc, segments: segs });
}
