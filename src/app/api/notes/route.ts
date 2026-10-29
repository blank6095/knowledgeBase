import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { desc, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { badRequest, guard } from '@/lib/api';
import { getCache, invalidateCache, setCache } from '@/lib/cache';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries, rebuildLinksQueries } from '@/lib/links';
import { extractInlineTags } from '@/lib/markdown';
import { splitMarkdown, type RawSegment } from '@/lib/splitter';
import { semanticSplit } from '@/lib/ai-split';
import { getLlmConfig } from '@/lib/llm';
import { deleteOriginal, putOriginal } from '@/lib/r2';


/** 记忆度 SQL 表达式：与 src/lib/memory.ts memoryOf 公式一致 exp(-Δt天/S)，ε 防除零 */
const MEMORY_SQL = (stability: typeof segments.stability, lastViewedAt: typeof segments.lastViewedAt) =>
  sql`exp(-extract(epoch from (now() - ${lastViewedAt})) / 86400.0 / greatest(${stability}, 1e-9))`;

const DOCS_CACHE_KEY = 'docs';
const DOCS_CACHE_TTL_MS = 60_000;

type DocsPayload = {
  documents: (Pick<typeof documents.$inferSelect, 'id' | 'title' | 'source' | 'tags' | 'segmentCount' | 'createdAt'> & {
    avgMemory: number;
  })[];
};

/** 文档列表（含平均记忆度：SQL 聚合下推，按文档分组返回，不拉全表行） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const cached = getCache<DocsPayload>(DOCS_CACHE_KEY);
  if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  const t0 = performance.now();
  const [docs, memAgg] = await Promise.all([
    db.select().from(documents).orderBy(desc(documents.createdAt)),
    db
      .select({
        documentId: segments.documentId,
        avgMemory: sql<number>`coalesce(avg(
          case when ${segments.stability} <= 0 or ${segments.lastViewedAt} is null then 0
          else ${MEMORY_SQL(segments.stability, segments.lastViewedAt)} end
        ), 0)::float8`,
      })
      .from(segments)
      .groupBy(segments.documentId),
  ]);
  const tDb = performance.now();

  const memoryByDoc = new Map(memAgg.map((r) => [r.documentId, r.avgMemory]));
  const rows = docs.map((d) => ({
    id: d.id,
    title: d.title,
    source: d.source,
    tags: d.tags,
    segmentCount: d.segmentCount,
    createdAt: d.createdAt,
    avgMemory: memoryByDoc.get(d.id) ?? 0,
  }));
  const t1 = performance.now();
  console.log(
    `[perf] GET /api/notes db=${(tDb - t0).toFixed(1)}ms transform=${(t1 - tDb).toFixed(1)}ms total=${(t1 - t0).toFixed(1)}ms docRows=${docs.length} aggRows=${memAgg.length}`,
  );

  const payload: DocsPayload = { documents: rows };
  setCache(DOCS_CACHE_KEY, payload, DOCS_CACHE_TTL_MS);

  const res = NextResponse.json(payload);
  res.headers.set('X-Cache', 'MISS');
  res.headers.set(
    'Server-Timing',
    `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
  );
  return res;
}

interface ImportBody {
  title?: unknown;
  content?: unknown;
  source?: 'paste' | 'file';
  filename?: unknown;
  maxChars?: unknown;
  aiSplit?: unknown;
}

/** 导入 Markdown：分割为知识点 → 建库 → 建立 wiki/tag/doc 三类关联 → 原文存 R2 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as ImportBody;
  if (body.content !== undefined && typeof body.content !== 'string') return badRequest('content 必须是字符串');
  if (body.title !== undefined && typeof body.title !== 'string') return badRequest('title 必须是字符串');
  if (body.filename !== undefined && typeof body.filename !== 'string') return badRequest('filename 必须是字符串');
  if (body.maxChars !== undefined && (typeof body.maxChars !== 'number' || !Number.isFinite(body.maxChars))) {
    return badRequest('maxChars 必须是有限数字');
  }
  const content = (body.content ?? '').trim();
  if (!content) return badRequest('内容为空');
  const maxChars = Math.min(Math.max(body.maxChars ?? 1800, 300), 4000);

  const { fmTitle, fmTags, segments: rawSegments } = splitMarkdown(content, { maxChars });
  if (rawSegments.length === 0) return badRequest('没有识别到有效内容');

  // 可选 LLM 语义拆分：仅处理 content 超过 maxChars 的段（按长度降序，每篇至多 5 段），
  // 任一段失败/超时降级保留该段结构拆分结果并计数，绝不阻断导入。
  let finalSegments: RawSegment[] = rawSegments;
  let aiSplitApplied = 0;
  let aiSplitFailed = 0;
  if (body.aiSplit === true && (await getLlmConfig())) {
    const eligible = rawSegments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.content.length > maxChars)
      .sort((a, b) => b.s.content.length - a.s.content.length)
      .slice(0, 5);
    const replacements = new Map<number, RawSegment[]>();
    // L1-4：并发 ≤2 的池化执行（导入总时长 ≈ ceil(n/2)×单次时延），失败降级语义不变
    const queue = [...eligible];
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        try {
          const { children } = await semanticSplit({ title: item.s.title, content: item.s.content }, 'import-split');
          replacements.set(
            item.i,
            children.map((c) => ({ title: c.title, content: c.content, headingPath: item.s.headingPath })),
          );
          aiSplitApplied++;
        } catch {
          aiSplitFailed++;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (replacements.size > 0) {
      finalSegments = rawSegments.flatMap((s, i) => replacements.get(i) ?? [s]);
    }
  }

  const docTitle =
    (body.title ?? '').trim() ||
    fmTitle?.trim() ||
    (body.filename ? body.filename.replace(/\.(md|markdown|txt)$/i, '') : '') ||
    rawSegments[0].title ||
    '未命名笔记';

  const bodyInlineTags = extractInlineTags(content);
  const docTags = [...new Set([...fmTags, ...bodyInlineTags])].slice(0, 30);
  const documentId = randomUUID();
  const inserted = finalSegments.map((s, i) => ({
    id: randomUUID(),
    documentId,
    title: s.title.slice(0, 200),
    content: s.content,
    headingPath: s.headingPath.slice(0, 300),
    orderIndex: i,
    tags: [...new Set([...fmTags, ...extractInlineTags(s.content)])].slice(0, 20),
  }));

  await runBatch([
    db.insert(documents).values({
      id: documentId,
      title: docTitle,
      source: body.source === 'file' ? 'file' : 'paste',
      filename: body.filename ?? null,
      storageKey: null,
      tags: docTags,
      segmentCount: inserted.length,
    }),
    db.insert(segments).values(inserted),
    ...rebuildLinksQueries(inserted.map((segment) => segment.id)),
    ...rebuildDocQueries(documentId),
  ]);

  const storageKey = await putOriginal(content, body.filename ?? `${docTitle}.md`);
  if (storageKey) {
    try {
      await db.update(documents).set({ storageKey }).where(sql`${documents.id} = ${documentId}`);
    } catch (error) {
      await deleteOriginal(storageKey);
      console.error('R2 对象键回写失败，已清理备份:', error);
    }
  }

  const [linkCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(links)
    .where(or(inArray(links.fromId, inserted.map((segment) => segment.id)), inArray(links.toId, inserted.map((segment) => segment.id))))
    .catch(() => []);

  // 导入成功后：图谱/概览/列表/该文档详情统一失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache(DOCS_CACHE_KEY);
  invalidateCache(`note:${documentId}`);

  return NextResponse.json({
    documentId,
    segmentCount: inserted.length,
    linkCount: linkCountRow?.count ?? 0,
    aiSplitApplied,
    aiSplitFailed,
  });
}
