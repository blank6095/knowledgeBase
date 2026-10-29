import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { generateRecallQuestion } from '@/lib/recall-question';

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { segmentId?: unknown };
  if (typeof body.segmentId !== 'string' || !isUuid(body.segmentId)) return badRequest('segmentId 无效');

  const [segment] = await db
    .select({
      id: segments.id,
      title: segments.title,
      content: segments.content,
      summary: segments.summary,
      documentId: segments.documentId,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id))
    .where(eq(segments.id, body.segmentId));
  if (!segment) return notFound('知识点不存在');

  const question = await generateRecallQuestion(segment);
  return NextResponse.json({
    segment: {
      id: segment.id,
      title: segment.title,
      documentId: segment.documentId,
      documentTitle: segment.documentTitle ?? '未知文档',
    },
    ...question,
  });
}
