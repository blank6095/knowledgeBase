import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray, sql, arrayOverlaps } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { badRequest, guard } from '@/lib/api';
import { extractInlineTags, extractWikiLinks } from '@/lib/markdown';
import { splitMarkdown, type RawSegment } from '@/lib/splitter';
import { semanticSplit } from '@/lib/ai-split';
import { getLlmConfig } from '@/lib/llm';
import { putOriginal } from '@/lib/r2';


/** 记忆度 SQL 表达式：与 src/lib/memory.ts memoryOf 公式一致 exp(-Δt天/S)，ε 防除零 */
const MEMORY_SQL = (stability: typeof segments.stability, lastViewedAt: typeof segments.lastViewedAt) =>
  sql`exp(-extract(epoch from (now() - ${lastViewedAt})) / 86400.0 / greatest(${stability}, 1e-9))`;

/** 文档列表（含平均记忆度：SQL 聚合下推，按文档分组返回，不拉全表行） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

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

  const res = NextResponse.json({ documents: rows });
  res.headers.set(
    'Server-Timing',
    `db;dur=${(tDb - t0).toFixed(1)}, transform;dur=${(t1 - tDb).toFixed(1)}, total;dur=${(t1 - t0).toFixed(1)}`,
  );
  return res;
}

interface ImportBody {
  title?: string;
  content?: string;
  source?: 'paste' | 'file';
  filename?: string;
  maxChars?: number;
  aiSplit?: boolean;
}

/** 导入 Markdown：分割为知识点 → 建库 → 建立 wiki/tag/doc 三类关联 → 原文存 R2 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as ImportBody;
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
    for (const { s, i } of eligible) {
      try {
        const { children } = await semanticSplit({ title: s.title, content: s.content });
        replacements.set(i, children.map((c) => ({ title: c.title, content: c.content, headingPath: s.headingPath })));
        aiSplitApplied++;
      } catch {
        aiSplitFailed++;
      }
    }
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
  const storageKey = await putOriginal(content, body.filename ?? `${docTitle}.md`);

  const [doc] = await db
    .insert(documents)
    .values({ title: docTitle, source: body.source === 'file' ? 'file' : 'paste', filename: body.filename ?? null, storageKey, tags: docTags, segmentCount: finalSegments.length })
    .returning({ id: documents.id });

  const inserted = await db
    .insert(segments)
    .values(
      finalSegments.map((s, i) => ({
        documentId: doc.id,
        title: s.title.slice(0, 200),
        content: s.content,
        headingPath: s.headingPath.slice(0, 300),
        orderIndex: i,
        tags: [...new Set([...fmTags, ...extractInlineTags(s.content)])].slice(0, 20),
      })),
    )
    .returning({ id: segments.id, title: segments.title, tags: segments.tags, orderIndex: segments.orderIndex });

  const linkRows = await buildLinks(doc.id, inserted, finalSegments, docTags);
  if (linkRows.length > 0) {
    await db.insert(links).values(linkRows).onConflictDoNothing();
  }
  await db.update(documents).set({ segmentCount: inserted.length }).where(eq(documents.id, doc.id));

  return NextResponse.json({
    documentId: doc.id,
    segmentCount: inserted.length,
    linkCount: linkRows.length,
    aiSplitApplied,
    aiSplitFailed,
  });
}

interface NewSeg {
  id: string;
  title: string;
  tags: string[];
  orderIndex: number;
}

/** 建立三类关联边：doc（同文档相邻）/ wiki（[[双链]]按标题匹配）/ tag（共同标签） */
async function buildLinks(
  docId: string,
  newSegs: NewSeg[],
  rawSegments: { title: string; content: string }[],
  docTags: string[],
): Promise<{ fromId: string; toId: string; kind: string; weight: number }[]> {
  const byOrder = [...newSegs].sort((a, b) => a.orderIndex - b.orderIndex);
  const rows: { fromId: string; toId: string; kind: string; weight: number }[] = [];
  const seen = new Set<string>();
  const add = (fromId: string, toId: string, kind: string, weight: number) => {
    if (fromId === toId) return;
    const key = `${fromId}|${toId}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ fromId, toId, kind, weight });
  };

  // 同文档相邻知识点
  for (let i = 1; i < byOrder.length; i++) add(byOrder[i - 1].id, byOrder[i].id, 'doc', 0.3);

  // wiki 双链：目标名与任意知识点的标题匹配（忽略大小写）
  const targets = new Set<string>();
  rawSegments.forEach((s) => extractWikiLinks(s.content).forEach((t) => targets.add(t.trim().toLowerCase())));
  if (targets.size > 0) {
    const matched = await db
      .select({ id: segments.id, title: segments.title })
      .from(segments)
      .where(inArray(sql`lower(${segments.title})`, [...targets]));

    // 标题(小写) → 知识点 id 列表，新导入的段落也参与
    const titleToIds = new Map<string, string[]>();
    const indexTitle = (id: string, title: string) => {
      const k = title.trim().toLowerCase();
      titleToIds.set(k, [...(titleToIds.get(k) ?? []), id]);
    };
    matched.forEach((m) => indexTitle(m.id, m.title));
    newSegs.forEach((s) => indexTitle(s.id, s.title));

    for (let i = 0; i < rawSegments.length; i++) {
      const myTargets = extractWikiLinks(rawSegments[i].content).map((t) => t.trim().toLowerCase());
      for (const t of myTargets) {
        for (const targetId of titleToIds.get(t) ?? []) {
          add(newSegs[i].id, targetId, 'wiki', 1);
        }
      }
    }
  }

  // 共同标签：与全库中共享标签的知识点相连
  const allTags = [...new Set([...docTags, ...newSegs.flatMap((s) => s.tags)])].filter(Boolean);
  if (allTags.length > 0) {
    const others = await db
      .select({ id: segments.id, tags: segments.tags })
      .from(segments)
      .where(arrayOverlaps(segments.tags, allTags))
      .limit(2000);
    for (const seg of newSegs) {
      for (const other of others) {
        if (seg.id === other.id) continue;
        const shared = seg.tags.filter((t) => other.tags.includes(t)).length;
        if (shared > 0) add(seg.id, other.id, 'tag', Math.min(1, shared / 3));
      }
    }
  }

  return rows.slice(0, 3000);
}
