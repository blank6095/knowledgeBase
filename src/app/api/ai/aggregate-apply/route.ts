import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { stripMarkdown } from '@/lib/markdown';
import { rebuildDocChain, rebuildSegmentLinks } from '@/lib/links';
import { migrateAnnotations } from '@/lib/annotation-migrate';

/**
 * 语义聚合应用（用户已确认预览）：
 * orderIndex 最小的段更新为融合稿并继承记忆（stability=max、viewCount/readingMs=sum、
 * firstViewedAt=min、lastViewedAt=max），其余段删除；
 * rebuildSegmentLinks + rebuildDocChain；被删段标注迁移到合并段（locate 降级，失败置无效）。
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

  // 被删段的标注先迁移（DELETE 级联会清标注）：合并稿渲染文本 locate 降级，未命中落 keeper 置无效
  const keeperText = stripMarkdown(merged.content);
  const { migrated, invalid } = await migrateAnnotations({
    fromSegmentIds: others.map((o) => o.id),
    candidates: [{ segmentId: keeper.id, text: keeperText }],
    fallbackSegmentId: keeper.id,
  });

  // 记忆合并：stability=max、viewCount/readingMs=sum、firstViewedAt=min、lastViewedAt=max
  const times = rows.map((r) => r.firstViewedAt?.getTime()).filter((v): v is number => v != null);
  const lastTimes = rows.map((r) => r.lastViewedAt?.getTime()).filter((v): v is number => v != null);
  const [updated] = await db
    .update(segments)
    .set({
      title: merged.title.trim().slice(0, 200),
      content: merged.content,
      stability: Math.max(...rows.map((r) => r.stability)),
      viewCount: rows.reduce((s, r) => s + r.viewCount, 0),
      readingMs: rows.reduce((s, r) => s + Number(r.readingMs), 0),
      firstViewedAt: times.length ? new Date(Math.min(...times)) : null,
      lastViewedAt: lastTimes.length ? new Date(Math.max(...lastTimes)) : null,
    })
    .where(eq(segments.id, keeper.id))
    .returning({ id: segments.id, title: segments.title, orderIndex: segments.orderIndex });

  await db.delete(segments).where(inArray(segments.id, others.map((o) => o.id)));

  await rebuildSegmentLinks({ id: keeper.id, content: merged.content, tags: keeper.tags });
  await rebuildDocChain(keeper.documentId);

  // 聚合涉及更新/删除、边重建与标注迁移，全部写完后统一失效
  invalidateCache('graph');
  invalidateCache('stats');
  invalidateCache('docs');
  invalidateCache(`note:${keeper.documentId}`);

  return NextResponse.json({ segment: updated, removed: others.length, migrated, invalid });
}
