import { and, asc, eq, inArray, or, sql, arrayOverlaps } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { extractWikiLinks } from '@/lib/markdown';

/**
 * 服务端链接维护：知识点编辑后保持 links 与语义一致。
 * 语义与导入时 buildLinks（api/notes/route.ts）对齐：
 * wiki = 内容 [[双链]] 按标题小写全库匹配；tag = 共同标签（weight = min(1, 共享数/3)）；
 * doc = 同文档相邻链 i-1→i（weight 0.3）。
 */

/** 段内容/标题/标签变更后，重建该段参与的 wiki 与 tag 边（doc 边不受影响） */
export async function rebuildSegmentLinks(seg: {
  id: string;
  content: string;
  tags: string[];
}): Promise<void> {
  await db
    .delete(links)
    .where(
      and(
        or(eq(links.fromId, seg.id), eq(links.toId, seg.id)),
        inArray(links.kind, ['wiki', 'tag']),
      ),
    );

  // wiki：内容双链目标按标题（小写）匹配全库知识点
  const targets = [...new Set(extractWikiLinks(seg.content).map((t) => t.trim().toLowerCase()))].filter(Boolean);
  if (targets.length > 0) {
    const matched = await db
      .select({ id: segments.id })
      .from(segments)
      .where(inArray(sql`lower(${segments.title})`, targets));
    const rows = matched
      .filter((m) => m.id !== seg.id)
      .map((m) => ({ fromId: seg.id, toId: m.id, kind: 'wiki', weight: 1 }));
    if (rows.length > 0) await db.insert(links).values(rows).onConflictDoNothing();
  }

  // tag：与全库共享标签的知识点相连（与导入时一致，上限 2000）
  if (seg.tags.length > 0) {
    const others = await db
      .select({ id: segments.id, tags: segments.tags })
      .from(segments)
      .where(arrayOverlaps(segments.tags, seg.tags))
      .limit(2000);
    const rows: { fromId: string; toId: string; kind: string; weight: number }[] = [];
    for (const other of others) {
      if (other.id === seg.id) continue;
      const shared = seg.tags.filter((t) => other.tags.includes(t)).length;
      if (shared > 0) rows.push({ fromId: seg.id, toId: other.id, kind: 'tag', weight: Math.min(1, shared / 3) });
    }
    if (rows.length > 0) await db.insert(links).values(rows).onConflictDoNothing();
  }
}

/** 文档结构变更（增/删/移段）后：归一化 orderIndex、重接 doc 相邻链、刷新 segmentCount */
export async function rebuildDocChain(documentId: string): Promise<void> {
  const segs = await db
    .select({ id: segments.id, orderIndex: segments.orderIndex })
    .from(segments)
    .where(eq(segments.documentId, documentId))
    .orderBy(asc(segments.orderIndex), asc(segments.createdAt));

  const ids = segs.map((s) => s.id);
  // 归一化序号（0..n-1）；仅在出现空洞/重复时才写库
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].orderIndex !== i) {
      await db.update(segments).set({ orderIndex: i }).where(eq(segments.id, segs[i].id));
      segs[i].orderIndex = i;
    }
  }

  // doc 边只存在于同文档段之间：先清后建
  if (ids.length > 0) {
    await db.delete(links).where(and(eq(links.kind, 'doc'), inArray(links.fromId, ids)));
  }
  const chain: { fromId: string; toId: string; kind: string; weight: number }[] = [];
  for (let i = 1; i < segs.length; i++) {
    chain.push({ fromId: segs[i - 1].id, toId: segs[i].id, kind: 'doc', weight: 0.3 });
  }
  if (chain.length > 0) await db.insert(links).values(chain).onConflictDoNothing();

  await db.update(documents).set({ segmentCount: segs.length }).where(eq(documents.id, documentId));
}
