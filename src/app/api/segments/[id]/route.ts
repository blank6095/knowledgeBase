import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { badRequest, dbUnavailable, guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { withDbRetry } from '@/lib/db-retry';
import { memoryOf } from '@/lib/memory';
import { extractInlineTags } from '@/lib/markdown';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries, rebuildLinksQueries } from '@/lib/links';
import {
  getSegmentCache,
  getStaleSegmentCache,
  invalidateSegmentCaches,
  setSegmentCache,
  type SegmentNeighbor,
  type SegmentRaw,
} from '@/lib/segment-cache';

/**
 * 读取段详情所需的原始行。
 *
 * 取数压成「一轮并行」：Neon HTTP 驱动每次查询都是一次网络往返（RTT ≈ 270ms），
 * 原实现分两批串行（先段+边，再文档+邻段），总耗时约 2×RTT；
 * 现在把文档标题并进段查询、把对端段信息并进边查询，两条并发发出只需 1×RTT。
 *
 * 对端段用 alias 自连接一次取回（case when 求边的另一端），
 * 省掉原先「先查边、再按边里的 id 批量查邻段」的第三轮往返。
 */
async function loadSegmentRaw(id: string): Promise<SegmentRaw | null> {
  const neighbor = alias(segments, 'neighbor');
  const [segRows, edgeRows] = await Promise.all([
    withDbRetry(
      () =>
        db
          .select({
            id: segments.id,
            title: segments.title,
            content: segments.content,
            headingPath: segments.headingPath,
            tags: segments.tags,
            viewCount: segments.viewCount,
            firstViewedAt: segments.firstViewedAt,
            lastViewedAt: segments.lastViewedAt,
            stability: segments.stability,
            readingMs: segments.readingMs,
            summary: segments.summary,
            documentId: segments.documentId,
            orderIndex: segments.orderIndex,
            documentTitle: documents.title,
          })
          .from(segments)
          .leftJoin(documents, eq(documents.id, segments.documentId))
          .where(eq(segments.id, id)),
      { label: 'segment.row' },
    ),
    withDbRetry(
      () =>
        db
          .select({
            fromId: links.fromId,
            toId: links.toId,
            kind: links.kind,
            weight: links.weight,
            neighborId: neighbor.id,
            neighborTitle: neighbor.title,
            neighborStability: neighbor.stability,
            neighborLastViewedAt: neighbor.lastViewedAt,
            neighborOrderIndex: neighbor.orderIndex,
            neighborDocumentId: neighbor.documentId,
          })
          .from(links)
          .leftJoin(
            neighbor,
            sql`${neighbor.id} = case when ${links.fromId} = ${id} then ${links.toId} else ${links.fromId} end`,
          )
          .where(or(eq(links.fromId, id), eq(links.toId, id)))
          .orderBy(asc(links.id)),
      { label: 'segment.edges' },
    ),
  ]);

  const row = segRows[0];
  // 段不存在：不缓存 404，交给上层返回 notFound
  if (!row) return null;

  const edges = edgeRows.map((r) => ({ fromId: r.fromId, toId: r.toId, kind: r.kind, weight: r.weight }));

  // 同一邻段可能有多条边（wiki/tag/doc 各一），按 id 去重后作为邻段表
  const neighbors: SegmentNeighbor[] = [];
  const seen = new Set<string>();
  for (const r of edgeRows) {
    if (!r.neighborId || seen.has(r.neighborId)) continue;
    seen.add(r.neighborId);
    neighbors.push({
      id: r.neighborId,
      title: r.neighborTitle ?? '',
      stability: r.neighborStability ?? 0,
      lastViewedAt: r.neighborLastViewedAt,
      orderIndex: r.neighborOrderIndex ?? 0,
      documentId: r.neighborDocumentId ?? '',
    });
  }

  return {
    seg: {
      id: row.id,
      title: row.title,
      content: row.content,
      headingPath: row.headingPath,
      tags: row.tags,
      viewCount: row.viewCount,
      firstViewedAt: row.firstViewedAt,
      lastViewedAt: row.lastViewedAt,
      stability: row.stability,
      readingMs: row.readingMs,
      summary: row.summary,
      documentId: row.documentId,
      orderIndex: row.orderIndex,
    },
    document: row.documentTitle != null ? { id: row.documentId, title: row.documentTitle } : null,
    edges,
    neighbors,
  };
}

/**
 * 由原始行组装响应体。
 *
 * 记忆度（memory）在读取时现算：缓存里只放原始字段（stability/lastViewedAt），
 * 命中缓存时灯点仍随时间衰减，不会被冻结在写入时刻。
 */
function buildPayload(raw: SegmentRaw) {
  const seg = raw.seg;
  const now = new Date();
  const byId = new Map(raw.neighbors.map((r) => [r.id, r] as const));
  const toItem = (r: SegmentNeighbor) => ({ id: r.id, title: r.title, memory: memoryOf(r.stability, r.lastViewedAt, now) });
  /** 组内按目标去重（links_unique 保证同 kind 每对仅一条，此处防御跨 kind 汇入） */
  const dedupe = (rows: SegmentNeighbor[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  const resolve = (edgeTargets: string[]) =>
    dedupe(edgeTargets.map((t) => byId.get(t)).filter((r): r is SegmentNeighbor => !!r));

  // wiki 有向边：from 提及 to
  const outgoing = resolve(raw.edges.filter((e) => e.kind === 'wiki' && e.fromId === seg.id).map((e) => e.toId));
  const incoming = resolve(raw.edges.filter((e) => e.kind === 'wiki' && e.toId === seg.id).map((e) => e.fromId));
  const relatedTags = resolve(raw.edges.filter((e) => e.kind === 'tag').map((e) => (e.fromId === seg.id ? e.toId : e.fromId)));

  // doc 边为同文档相邻链 i-1→i：按 orderIndex ±1 映射上一节/下一节
  let prev: SegmentNeighbor | null = null;
  let next: SegmentNeighbor | null = null;
  for (const e of raw.edges) {
    if (e.kind !== 'doc') continue;
    const r = byId.get(e.fromId === seg.id ? e.toId : e.fromId);
    if (!r || r.documentId !== seg.documentId) continue;
    if (r.orderIndex === seg.orderIndex - 1) prev = r;
    if (r.orderIndex === seg.orderIndex + 1) next = r;
  }

  return {
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
    document: raw.document,
    links: raw.edges,
    refs: {
      outgoing: outgoing.map(toItem),
      incoming: incoming.map(toItem),
      prev: prev ? toItem(prev) : null,
      next: next ? toItem(next) : null,
      relatedTags: relatedTags.map(toItem),
    },
  };
}

/**
 * 知识点详情：内容 + 结构化链接（出/入链、上一/下一节、共同标签）+ 原始边。
 *
 * 缓存：段详情只读且读多写少，命中缓存可省掉一整轮 DB 往返（warm p50 目标 <200ms）。
 * 缓存的是原始行而非响应体，记忆度读取时现算；写路径（编辑/删除/排序/导入/AI 拆分合并）
 * 统一调用 invalidateSegmentCaches() 主动失效。
 * 缓存为进程内 best-effort，不承担一致性职责；鉴权在缓存之前（guard），且段详情
 * 不含跨用户敏感字段，故可安全缓存。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const t0 = performance.now();
  let raw: SegmentRaw | null = getSegmentCache(id) ?? null;
  let cacheState: 'HIT' | 'MISS' | 'STALE' = raw ? 'HIT' : 'MISS';

  if (!raw) {
    try {
      raw = await loadSegmentRaw(id);
    } catch {
      // 数据库不可用：回退到陈旧快照（宁可给 slightly old 的数据，也不要整页报错）
      const stale = getStaleSegmentCache(id);
      if (!stale) return dbUnavailable();
      raw = stale;
      cacheState = 'STALE';
    }
    if (!raw) return notFound('知识点不存在');
    if (cacheState === 'MISS') setSegmentCache(id, raw);
  }

  const t1 = performance.now();
  const payload = buildPayload(raw);
  const t2 = performance.now();
  console.log(
    `[perf] GET /api/segments/${id} cache=${cacheState} db=${(t1 - t0).toFixed(1)}ms transform=${(t2 - t1).toFixed(1)}ms total=${(t2 - t0).toFixed(1)}ms edges=${raw.edges.length}`,
  );

  const res = NextResponse.json(payload);
  res.headers.set('X-Cache', cacheState);
  res.headers.set(
    'Server-Timing',
    `db;dur=${(t1 - t0).toFixed(1)}, transform;dur=${(t2 - t1).toFixed(1)}, total;dur=${(t2 - t0).toFixed(1)}`,
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
    title?: unknown;
    content?: unknown;
    tags?: unknown;
  };
  const patch: { title?: string; content?: string; tags?: string[]; summary?: null } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return badRequest('title 必须是字符串');
    const t = body.title.trim();
    if (!t) return badRequest('标题不能为空');
    patch.title = t.slice(0, 200);
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') return badRequest('content 必须是字符串');
    patch.content = body.content;
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) return badRequest('tags 必须是字符串数组');
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  }
  if (Object.keys(patch).length === 0) return badRequest('没有可更新的字段');

  const [seg] = await db.select().from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  if (patch.content !== undefined && patch.content !== seg.content) patch.summary = null;
  const nextContent = patch.content ?? seg.content;
  const nextTags = [...new Set([
    ...(patch.tags ?? seg.tags),
    ...(patch.content !== undefined ? extractInlineTags(nextContent) : []),
  ])].slice(0, 20);
  if (patch.content !== undefined || patch.tags !== undefined) patch.tags = nextTags;
  const [updatedRows] = (await runBatch([
    db.update(segments).set(patch).where(eq(segments.id, id)).returning(),
    ...rebuildLinksQueries([id]),
  ])) as [Array<typeof segments.$inferSelect>];
  const updated = updatedRows[0];

  // 段标题/内容/标签/chunk 边变化：图谱、统计、列表与文档详情均需失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${seg.documentId}`);
  // 段内容与边变了，本段及邻段的详情都要重取
  invalidateSegmentCaches();

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

  await runBatch([
    db.delete(segments).where(eq(segments.id, id)),
    ...rebuildDocQueries(seg.documentId),
  ]);

  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${seg.documentId}`);
  invalidateSegmentCaches();

  return NextResponse.json({ ok: true });
}
