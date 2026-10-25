import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { memoryOf } from '@/lib/memory';
import { extractInlineTags } from '@/lib/markdown';
import { rebuildDocChain, rebuildSegmentLinks } from '@/lib/links';

interface NeighborRow {
  id: string;
  title: string;
  stability: number;
  lastViewedAt: Date | null;
  orderIndex: number;
  documentId: string;
}

/** 知识点详情：内容 + 结构化链接（出/入链、上一/下一节、共同标签）+ 原始边 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const t0 = performance.now();
  const [segRows, edges] = await Promise.all([
    db.select().from(segments).where(eq(segments.id, id)),
    db
      .select({ fromId: links.fromId, toId: links.toId, kind: links.kind, weight: links.weight })
      .from(links)
      .where(or(eq(links.fromId, id), eq(links.toId, id))),
  ]);
  const t1 = performance.now();
  const seg = segRows[0];
  if (!seg) return notFound('知识点不存在');

  const targetIds = [...new Set(edges.map((e) => (e.fromId === id ? e.toId : e.fromId)))];
  const [docRows, neighborRows] = await Promise.all([
    db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.id, seg.documentId)),
    targetIds.length
      ? db
          .select({
            id: segments.id,
            title: segments.title,
            stability: segments.stability,
            lastViewedAt: segments.lastViewedAt,
            orderIndex: segments.orderIndex,
            documentId: segments.documentId,
          })
          .from(segments)
          .where(inArray(segments.id, targetIds))
      : Promise.resolve([] as NeighborRow[]),
  ]);
  const t2 = performance.now();

  const now = new Date();
  const byId = new Map(neighborRows.map((r) => [r.id, r] as const));
  const toItem = (r: NeighborRow) => ({ id: r.id, title: r.title, memory: memoryOf(r.stability, r.lastViewedAt, now) });
  /** 组内按目标去重（links_unique 保证同 kind 每对仅一条，此处防御跨 kind 汇入） */
  const dedupe = (rows: NeighborRow[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  const resolve = (edgeTargets: string[]) =>
    dedupe(edgeTargets.map((t) => byId.get(t)).filter((r): r is NeighborRow => !!r));

  // wiki 有向边：from 提及 to
  const outgoing = resolve(edges.filter((e) => e.kind === 'wiki' && e.fromId === id).map((e) => e.toId));
  const incoming = resolve(edges.filter((e) => e.kind === 'wiki' && e.toId === id).map((e) => e.fromId));
  const relatedTags = resolve(edges.filter((e) => e.kind === 'tag').map((e) => (e.fromId === id ? e.toId : e.fromId)));

  // doc 边为同文档相邻链 i-1→i：按 orderIndex ±1 映射上一节/下一节
  let prev: NeighborRow | null = null;
  let next: NeighborRow | null = null;
  for (const e of edges) {
    if (e.kind !== 'doc') continue;
    const r = byId.get(e.fromId === id ? e.toId : e.fromId);
    if (!r || r.documentId !== seg.documentId) continue;
    if (r.orderIndex === seg.orderIndex - 1) prev = r;
    if (r.orderIndex === seg.orderIndex + 1) next = r;
  }

  const payload = {
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
      summary: seg.summary,
    },
    document: docRows[0] ?? null,
    links: edges,
    refs: {
      outgoing: outgoing.map(toItem),
      incoming: incoming.map(toItem),
      prev: prev ? toItem(prev) : null,
      next: next ? toItem(next) : null,
      relatedTags: relatedTags.map(toItem),
    },
  };
  const t3 = performance.now();
  console.log(
    `[perf] GET /api/segments/${id} seg+edges=${(t1 - t0).toFixed(1)}ms doc+neighbors=${(t2 - t1).toFixed(1)}ms transform=${(t3 - t2).toFixed(1)}ms total=${(t3 - t0).toFixed(1)}ms edges=${edges.length}`,
  );

  const res = NextResponse.json(payload);
  res.headers.set(
    'Server-Timing',
    `q1;dur=${(t1 - t0).toFixed(1)}, q2;dur=${(t2 - t1).toFixed(1)}, transform;dur=${(t3 - t2).toFixed(1)}, total;dur=${(t3 - t0).toFixed(1)}`,
  );
  return res;
}

/**
 * 编辑知识点（标题/内容/标签）：记忆字段与 reading_events 原样保留；
 * 内容/标签变更后重建该段参与的 wiki/tag 边（doc 相邻边不受影响）。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    content?: string;
    tags?: string[];
  };
  const patch: { title?: string; content?: string; tags?: string[] } = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return badRequest('标题不能为空');
    patch.title = t.slice(0, 200);
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') return badRequest('content 必须是字符串');
    patch.content = body.content;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新的字段');

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const [updated] = await db.update(segments).set(patch).where(eq(segments.id, id)).returning();

  // wiki/tag 边依赖内容与标签，重建；仅标题变更也需重建（wiki 按标题匹配）
  const nextContent = patch.content ?? seg.content;
  const nextTags = patch.tags ?? (patch.content !== undefined ? [...new Set([...seg.tags, ...extractInlineTags(nextContent)])] : seg.tags);
  await rebuildSegmentLinks({ id, content: nextContent, tags: nextTags });

  const now = new Date();
  return NextResponse.json({
    segment: {
      id: updated.id,
      title: updated.title,
      content: updated.content,
      headingPath: updated.headingPath,
      tags: updated.tags,
      viewCount: updated.viewCount,
      stability: updated.stability,
      readingMs: Number(updated.readingMs),
      memory: memoryOf(updated.stability, updated.lastViewedAt, now),
    },
  });
}

/** 删除知识点：级联清理其边与标注，随后重接同文档相邻链并刷新计数 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [seg] = await db.select({ id: segments.id, documentId: segments.documentId }).from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  await db.delete(segments).where(eq(segments.id, id));
  await rebuildDocChain(seg.documentId);
  return NextResponse.json({ ok: true });
}
