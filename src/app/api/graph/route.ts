import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { guard } from '@/lib/api';


/** 关系图谱数据：节点=知识点（含掌握度），边=关联（wiki/tag/doc） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const nodes = await db
    .select({
      id: segments.id,
      title: segments.title,
      mastery: segments.mastery,
      status: segments.status,
      viewCount: segments.viewCount,
      dueAt: segments.dueAt,
      tags: segments.tags,
      documentId: segments.documentId,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id));

  const edges = await db
    .select({ source: links.fromId, target: links.toId, kind: links.kind, weight: links.weight })
    .from(links);

  return NextResponse.json({ nodes, edges });
}
