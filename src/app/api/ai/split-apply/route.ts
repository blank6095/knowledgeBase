import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { extractInlineTags, stripMarkdown } from '@/lib/markdown';
import { rebuildDocChain, rebuildSegmentLinks } from '@/lib/links';
import { migrateAnnotations } from '@/lib/annotation-migrate';

interface Child {
  title: string;
  content: string;
}

function parseChildren(input: unknown): Child[] | null {
  if (!Array.isArray(input)) return null;
  const children = input
    .filter(
      (c): c is { title: string; content: string } =>
        !!c && typeof c === 'object' && typeof (c as { title?: unknown }).title === 'string' && typeof (c as { content?: unknown }).content === 'string',
    )
    .map((c) => ({ title: c.title.trim().slice(0, 200), content: c.content.trim() }))
    .filter((c) => c.title && c.content)
    .slice(0, 8);
  return children.length >= 2 ? children : null;
}

/**
 * 语义拆解应用（用户已确认预览）：
 * 母段 PATCH 为第一个子段（记忆字段不动，readingMs 均分余数归第一子段）；
 * 其余子段按序插入其后（stability/viewCount 复制母段、readingMs 均分、first/lastViewedAt 复制）；
 * 每段 rebuildSegmentLinks + rebuildDocChain；母段标注按 locate 三级降级迁移到子段。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { segmentId?: string; children?: unknown };
  const segmentId = body.segmentId ?? '';
  if (!isUuid(segmentId)) return badRequest('segmentId 无效');
  const children = parseChildren(body.children);
  if (!children) return badRequest('children 需为 2–8 个含 title/content 的对象');

  const [seg] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!seg) return notFound('知识点不存在');

  const n = children.length;
  const totalMs = Number(seg.readingMs);
  const share = Math.floor(totalMs / n);
  const firstMs = totalMs - share * (n - 1); // 余数归第一子段，保证之和不变

  // 腾位：母段之后的同文档段整体后移 n-1 位
  if (n > 1) {
    await db
      .update(segments)
      .set({ orderIndex: sql`${segments.orderIndex} + ${n - 1}` })
      .where(and(eq(segments.documentId, seg.documentId), gte(segments.orderIndex, seg.orderIndex + 1)));
  }

  // 母段 → 第一子段（内容变更；记忆字段仅 readingMs 均分，其余原样即「复制」）
  const firstTags = [...new Set([...seg.tags, ...extractInlineTags(children[0].content)])].slice(0, 20);
  await db
    .update(segments)
    .set({ title: children[0].title, content: children[0].content, tags: firstTags, readingMs: firstMs })
    .where(eq(segments.id, seg.id));

  // 其余子段按序插入，并各自重建 wiki/tag 边
  const inserted: { id: string; title: string; orderIndex: number }[] = [];
  for (let k = 1; k < n; k++) {
    const tags = extractInlineTags(children[k].content).slice(0, 20);
    const [row] = await db
      .insert(segments)
      .values({
        documentId: seg.documentId,
        title: children[k].title,
        content: children[k].content,
        headingPath: children[k].title.slice(0, 300),
        orderIndex: seg.orderIndex + k,
        tags,
        stability: seg.stability,
        viewCount: seg.viewCount,
        readingMs: share,
        firstViewedAt: seg.firstViewedAt,
        lastViewedAt: seg.lastViewedAt,
      })
      .returning({ id: segments.id, title: segments.title, orderIndex: segments.orderIndex });
    inserted.push(row);
    await rebuildSegmentLinks({ id: row.id, content: children[k].content, tags });
  }

  // 边维护：母段内容变更后重建 wiki/tag；文档链归一化重接
  await rebuildSegmentLinks({ id: seg.id, content: children[0].content, tags: firstTags });
  await rebuildDocChain(seg.documentId);

  // 标注迁移：母段标注按子段渲染文本 locate 三级降级，全部不命中留在第一子段置无效
  const candidates = children.map((c, i) => ({
    segmentId: i === 0 ? seg.id : inserted[i - 1].id,
    text: stripMarkdown(c.content),
  }));
  const { migrated, invalid } = await migrateAnnotations({
    fromSegmentIds: [seg.id],
    candidates,
    fallbackSegmentId: seg.id,
  });

  // 拆解涉及段更新/插入、边重建与标注迁移，全部写完后统一失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${seg.documentId}`);

  return NextResponse.json({
    segments: [
      { id: seg.id, title: children[0].title, orderIndex: seg.orderIndex },
      ...inserted,
    ],
    migrated,
    invalid,
  });
}
