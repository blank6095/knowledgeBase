import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { annotations, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { planAnnotationMigration } from '@/lib/annotation-migrate';
import { invalidateCache } from '@/lib/cache';
import { runBatch } from '@/lib/db-batch';
import { rebuildDocQueries, rebuildLinksQueries } from '@/lib/links';
import { stripMarkdown } from '@/lib/markdown';

/**
 * 语义聚合应用（用户已确认预览）：
 * orderIndex 最小的段更新为融合稿并继承记忆（stability=max、viewCount/readingMs=sum、
 * firstViewedAt=min、lastViewedAt=max），其余段删除；
 * 标注迁移、段更新/删除、关系边和段数在同一 batch 事务内完成。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    segmentIds?: unknown;
    merged?: { title?: unknown; content?: unknown };
  };
  const ids = Array.isArray(body.segmentIds) ? body.segmentIds.filter((v): v is string => typeof v === 'string') : [];
  if (ids.length < 2) return badRequest('至少选择 2 个知识点');
  if (ids.length > 20) return badRequest('一次最多聚合 20 个知识点');
  if (!ids.every((v) => isUuid(v))) return badRequest('segmentIds 含无效 id');
  const merged = body.merged;
  if (!merged || typeof merged.title !== 'string' || typeof merged.content !== 'string' || !merged.title.trim() || !merged.content.trim()) {
    return badRequest('merged 需含非空 title/content');
  }

  const rows = await db.select().from(segments).where(inArray(segments.id, ids)).orderBy(asc(segments.orderIndex));
  if (rows.length !== ids.length) return notFound('部分知识点不存在');
  if (new Set(rows.map((r) => r.documentId)).size > 1) return badRequest('只能聚合同一文档下的知识点');

  const keeper = rows[0];
  const others = rows.slice(1);

  const keeperText = stripMarkdown(merged.content);
  const otherAnnotations = await db
    .select({
      id: annotations.id,
      segmentId: annotations.segmentId,
      quote: annotations.quote,
      occurrence: annotations.occurrence,
      prefix: annotations.prefix,
      suffix: annotations.suffix,
    })
    .from(annotations)
    .where(inArray(annotations.segmentId, others.map((other) => other.id)));
  const annotationPlan = planAnnotationMigration(otherAnnotations, {
    fromSegmentIds: others.map((o) => o.id),
    candidates: [{ segmentId: keeper.id, text: keeperText }],
    fallbackSegmentId: keeper.id,
  });

  // 记忆合并：stability=max、viewCount/readingMs=sum、firstViewedAt=min、lastViewedAt=max
  const times = rows.map((r) => r.firstViewedAt?.getTime()).filter((v): v is number => v != null);
  const lastTimes = rows.map((r) => r.lastViewedAt?.getTime()).filter((v): v is number => v != null);
  const nextTitle = merged.title.trim().slice(0, 200);
  const updated = { id: keeper.id, title: nextTitle, orderIndex: keeper.orderIndex };
  await runBatch([
    ...annotationPlan.updates.map((update) =>
      db
        .update(annotations)
        .set({ segmentId: update.segmentId, updatedAt: update.updatedAt })
        .where(eq(annotations.id, update.id)),
    ),
    db
      .update(segments)
      .set({
        title: nextTitle,
        content: merged.content,
        summary: null,
        stability: Math.max(...rows.map((r) => r.stability)),
        viewCount: rows.reduce((s, r) => s + r.viewCount, 0),
        readingMs: rows.reduce((s, r) => s + Number(r.readingMs), 0),
        firstViewedAt: times.length ? new Date(Math.min(...times)) : null,
        lastViewedAt: lastTimes.length ? new Date(Math.max(...lastTimes)) : null,
      })
      .where(eq(segments.id, keeper.id)),
    db.delete(segments).where(inArray(segments.id, others.map((o) => o.id))),
    ...rebuildLinksQueries([keeper.id]),
    ...rebuildDocQueries(keeper.documentId),
  ]);

  // 聚合涉及更新/删除、边重建与标注迁移，全部写完后统一失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${keeper.documentId}`);

  return NextResponse.json({
    segment: updated,
    removed: others.length,
    migrated: annotationPlan.migrated,
    invalid: annotationPlan.invalid,
  });
}
