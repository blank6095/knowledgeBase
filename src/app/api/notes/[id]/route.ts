import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
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

/** 编辑文档元信息（标题/标签）。知识点内容编辑见 PATCH /api/segments/[id] */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as { title?: string; tags?: string[] };
  const patch: { title?: string; tags?: string[] } = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return badRequest('标题不能为空');
    patch.title = t.slice(0, 300);
  }
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新的字段');

  const [doc] = await db.update(documents).set(patch).where(eq(documents.id, id)).returning();
  if (!doc) return notFound('文档不存在');
  return NextResponse.json({ document: doc });
}
