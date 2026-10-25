import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { annotations, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';

/** 文档全部标注（阅读视图用）：按段顺序 + 创建时间排序，带段标题供列表展示 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const rows = await db
    .select({
      id: annotations.id,
      segmentId: annotations.segmentId,
      kind: annotations.kind,
      quote: annotations.quote,
      occurrence: annotations.occurrence,
      prefix: annotations.prefix,
      suffix: annotations.suffix,
      note: annotations.note,
      color: annotations.color,
      createdAt: annotations.createdAt,
      updatedAt: annotations.updatedAt,
      segmentTitle: segments.title,
      segmentOrder: segments.orderIndex,
    })
    .from(annotations)
    .innerJoin(segments, eq(annotations.segmentId, segments.id))
    .where(eq(segments.documentId, id))
    .orderBy(asc(segments.orderIndex), asc(annotations.createdAt));

  return NextResponse.json({ annotations: rows });
}
