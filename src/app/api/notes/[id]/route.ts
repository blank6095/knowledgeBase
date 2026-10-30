import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, dbUnavailable, guard, isUuid, notFound } from '@/lib/api';
import { getCache, invalidateCache } from '@/lib/cache';
import { withDbRetry } from '@/lib/db-retry';
import { withStaleFallback } from '@/lib/db-read';
import { runBatch } from '@/lib/db-batch';
import { rebuildLinksQueries } from '@/lib/links';
import { memoryOf } from '@/lib/memory';
import { deleteOriginal } from '@/lib/r2';

const NOTE_CACHE_TTL_MS = 120_000;

type NotePayload = {
  document: typeof documents.$inferSelect;
  segments: {
    id: string;
    title: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    content: string;
    memory: number;
  }[];
};


/** 文档详情（阅读视图）：document 与 segments 并行查询，含各段 content */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const cacheKey = `note:${id}`;
  const cached = getCache<NotePayload>(cacheKey);
  if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  const t0 = performance.now();
  // 文档不存在返回 null（404），数据库故障抛出（走重试 + 陈旧快照降级）
  const loadNote = async (): Promise<NotePayload | null> => {
    const [docRows, segs] = await Promise.all([
      withDbRetry(() => db.select().from(documents).where(eq(documents.id, id)), { label: 'note.document' }),
      withDbRetry(
        () =>
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
        { label: 'note.segments' },
      ),
    ]);

    const doc = docRows[0];
    if (!doc) return null;

    const now = new Date();
    return {
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
  };

  try {
    const { value: payload, stale } = await withStaleFallback({
      cacheKey,
      ttlMs: NOTE_CACHE_TTL_MS,
      run: loadNote,
      label: 'note.detail',
    });
    if (!payload) return notFound('文档不存在');
    const tDb = performance.now();
    const t1 = performance.now();
    console.log(
      `[perf] GET /api/notes/${id} db=${(tDb - t0).toFixed(1)}ms transform=${(t1 - tDb).toFixed(1)}ms total=${(t1 - t0).toFixed(1)}ms segRows=${payload.segments.length}${stale ? ' stale=1' : ''}`,
    );

    const res = NextResponse.json(payload);
    res.headers.set('X-Cache', stale ? 'STALE' : 'MISS');
    res.headers.set(
      'Server-Timing',
      `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
    );
    return res;
  } catch {
    return dbUnavailable();
  }
}

/** 编辑文档元信息（标题/标签）。知识点内容编辑见 PATCH /api/segments/[id] */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as { title?: unknown; tags?: unknown };
  const patch: { title?: string; tags?: string[] } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return badRequest('title 必须是字符串');
    const t = body.title.trim();
    if (!t) return badRequest('标题不能为空');
    patch.title = t.slice(0, 300);
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) return badRequest('tags 必须是字符串数组');
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新的字段');

  const docSegmentIds =
    patch.tags !== undefined
      ? (await db.select({ id: segments.id }).from(segments).where(eq(segments.documentId, id))).map((seg) => seg.id)
      : [];
  const [updatedRows] = (await runBatch([
    db.update(documents).set(patch).where(eq(documents.id, id)).returning(),
    ...rebuildLinksQueries(docSegmentIds),
  ])) as [Array<typeof documents.$inferSelect>];
  const doc = updatedRows[0];
  if (!doc) return notFound('文档不存在');

  // 标题变化会同时影响列表、文档详情与图谱节点名；tags 也可能影响详情展示
  invalidateCache('docs');
  invalidateCache(`note:${id}`);
  invalidateCache('graph');
  invalidateCache('stats');

  return NextResponse.json({ document: doc });
}

/** 删除整篇文档；数据库外键会级联清理知识点、关联、标注与阅读流水。 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [doc] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ id: documents.id, storageKey: documents.storageKey });
  if (!doc) return notFound('文档不存在');

  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${id}`);
  if (doc.storageKey) await deleteOriginal(doc.storageKey);
  return NextResponse.json({ ok: true });
}
