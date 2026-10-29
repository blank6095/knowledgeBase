import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { annotations, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { planAnnotationMigration } from '@/lib/annotation-migrate';
import { invalidateCache } from '@/lib/cache';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries, rebuildLinksQueries } from '@/lib/links';
import { extractInlineTags, stripMarkdown } from '@/lib/markdown';

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
 * 母段更新为第一个子段（记忆字段不动，readingMs 均分余数归第一子段）；
 * 其余子段按序插入其后（stability/viewCount 复制母段、readingMs 均分、first/lastViewedAt 复制）；
 * 段更新、插入、标注迁移、关系边和段数在同一个 Neon batch 事务内完成。
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

  const firstTags = [...new Set([...seg.tags, ...extractInlineTags(children[0].content)])].slice(0, 20);
  const inserted = children.slice(1).map((child, index) => ({
    id: randomUUID(),
    title: child.title,
    orderIndex: seg.orderIndex + index + 1,
    tags: extractInlineTags(child.content).slice(0, 20),
    content: child.content,
  }));

  const candidates = children.map((child, index) => ({
    segmentId: index === 0 ? seg.id : inserted[index - 1].id,
    text: stripMarkdown(child.content),
  }));
  const sourceAnnotations = await db
    .select({
      id: annotations.id,
      segmentId: annotations.segmentId,
      quote: annotations.quote,
      occurrence: annotations.occurrence,
      prefix: annotations.prefix,
      suffix: annotations.suffix,
    })
    .from(annotations)
    .where(eq(annotations.segmentId, seg.id));
  const annotationPlan = planAnnotationMigration(sourceAnnotations, {
    fromSegmentIds: [seg.id],
    candidates,
    fallbackSegmentId: seg.id,
  });

  const queries = [
    ...(n > 1
      ? [
          db
            .update(segments)
            .set({ orderIndex: sql`${segments.orderIndex} + ${n - 1}` })
            .where(and(eq(segments.documentId, seg.documentId), gte(segments.orderIndex, seg.orderIndex + 1))),
        ]
      : []),
    db
      .update(segments)
      .set({ title: children[0].title, content: children[0].content, tags: firstTags, readingMs: firstMs, summary: null })
      .where(eq(segments.id, seg.id)),
    db.insert(segments).values(
      inserted.map((child) => ({
        documentId: seg.documentId,
        id: child.id,
        title: child.title,
        content: child.content,
        headingPath: child.title.slice(0, 300),
        orderIndex: child.orderIndex,
        tags: child.tags,
        stability: seg.stability,
        viewCount: seg.viewCount,
        readingMs: share,
        firstViewedAt: seg.firstViewedAt,
        lastViewedAt: seg.lastViewedAt,
      })),
    ),
    ...annotationPlan.updates.map((update) =>
      db
        .update(annotations)
        .set({ segmentId: update.segmentId, updatedAt: update.updatedAt })
        .where(eq(annotations.id, update.id)),
    ),
    ...rebuildLinksQueries([seg.id, ...inserted.map((child) => child.id)]),
    ...rebuildDocQueries(seg.documentId),
  ];
  await runBatch(queries);

  // 拆解涉及段更新/插入、边重建与标注迁移，全部写完后统一失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${seg.documentId}`);

  return NextResponse.json({
    segments: [
      { id: seg.id, title: children[0].title, orderIndex: seg.orderIndex },
      ...inserted.map(({ id, title, orderIndex }) => ({ id, title, orderIndex })),
    ],
    migrated: annotationPlan.migrated,
    invalid: annotationPlan.invalid,
  });
}
