import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';
import { memoryOf } from '@/lib/memory';


/** 文档详情（阅读视图）：document 与 segments 并行查询，含各段 content */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const t0 = performance.now();
  const [docRows, segs] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, id)),
    db
      .select({
        id: segments.id,
        title: segments.title,
        headingPath: segments.headingPath,
        tags: segments.tags,
        viewCount: segments.viewCount,
        content: segments.content,
        stability: segments.stability,
        lastViewedAt: segments.lastViewedAt,
      })
      .from(segments)
      .where(eq(segments.documentId, id))
      .orderBy(asc(segments.orderIndex)),
  ]);
  const tDb = performance.now();

  const doc = docRows[0];
  if (!doc) return notFound('文档不存在');

  const now = new Date();
  const payload = {
    document: doc,
    segments: segs.map((s) => ({
      id: s.id,
      title: s.title,
      headingPath: s.headingPath,
      tags: s.tags,
      viewCount: s.viewCount,
      content: s.content,
      memory: memoryOf(s.stability, s.lastViewedAt, now),
    })),
  };
  const t1 = performance.now();
  console.log(
    `[perf] GET /api/notes/${id} db=${(tDb - t0).toFixed(1)}ms transform=${(t1 - tDb).toFixed(1)}ms total=${(t1 - t0).toFixed(1)}ms segRows=${segs.length}`,
  );

  const res = NextResponse.json(payload);
  res.headers.set(
    'Server-Timing',
    `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
  );
  return res;
}
