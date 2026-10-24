import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray, sql, arrayOverlaps } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { badRequest, guard } from '@/lib/api';
import { extractInlineTags, extractWikiLinks } from '@/lib/markdown';
import { splitMarkdown } from '@/lib/splitter';
import { putOriginal } from '@/lib/r2';


/** 文档列表（含平均掌握度） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      source: documents.source,
      tags: documents.tags,
      segmentCount: documents.segmentCount,
      createdAt: documents.createdAt,
      avgMastery: sql<number>`coalesce(avg(${segments.mastery}), 0)::float`,
    })
    .from(documents)
    .leftJoin(segments, eq(segments.documentId, documents.id))
    .groupBy(documents.id)
    .orderBy(desc(documents.createdAt));
  return NextResponse.json({ documents: rows });
}

interface ImportBody {
  title?: string;
  content?: string;
  source?: 'paste' | 'file';
  filename?: string;
  maxChars?: number;
}

/** 导入 Markdown：分割为知识点 → 建库 → 建立 wiki/tag/doc 三类关联 → 原文存 R2 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as ImportBody;
  const content = (body.content ?? '').trim();
  if (!content) return badRequest('内容为空');
  const maxChars = Math.min(Math.max(body.maxChars ?? 1200, 300), 4000);

  const { fmTitle, fmTags, segments: rawSegments } = splitMarkdown(content, { maxChars });
  if (rawSegments.length === 0) return badRequest('没有识别到有效内容');

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
    .values({ title: docTitle, source: body.source === 'file' ? 'file' : 'paste', filename: body.filename ?? null, storageKey, tags: docTags, segmentCount: rawSegments.length })
    .returning({ id: documents.id });

  const inserted = await db
    .insert(segments)
    .values(
      rawSegments.map((s, i) => ({
        documentId: doc.id,
        title: s.title.slice(0, 200),
        content: s.content,
        headingPath: s.headingPath.slice(0, 300),
        orderIndex: i,
        tags: [...new Set([...fmTags, ...extractInlineTags(s.content)])].slice(0, 20),
      })),
    )
    .returning({ id: segments.id, title: segments.title, tags: segments.tags, orderIndex: segments.orderIndex });

  const linkRows = await buildLinks(doc.id, inserted, rawSegments, docTags);
  if (linkRows.length > 0) {
    await db.insert(links).values(linkRows).onConflictDoNothing();
  }
  await db.update(documents).set({ segmentCount: inserted.length }).where(eq(documents.id, doc.id));

  return NextResponse.json({ documentId: doc.id, segmentCount: inserted.length, linkCount: linkRows.length });
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
