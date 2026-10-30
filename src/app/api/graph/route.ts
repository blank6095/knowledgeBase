import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { dbUnavailable, guard } from '@/lib/api';
import { getCache } from '@/lib/cache';
import { withDbRetry } from '@/lib/db-retry';
import { withStaleFallback } from '@/lib/db-read';
import type { GraphPayload } from '@/lib/graph/graph-types';
import { memoryOf } from '@/lib/memory';

const CACHE_KEY = 'graph';
const CACHE_TTL_MS = 60_000;

/** 关系图谱数据：节点=知识点（记忆度读取时现算），边=关联（wiki/tag/doc） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const cached = getCache<GraphPayload>(CACHE_KEY);
  if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  const now = new Date();
  const loadGraph = async (): Promise<GraphPayload> => {
    const rows = await withDbRetry(
      () =>
        db
          .select({
            id: segments.id,
            title: segments.title,
            viewCount: segments.viewCount,
            stability: segments.stability,
            readingMs: segments.readingMs,
            lastViewedAt: segments.lastViewedAt,
            documentTitle: documents.title,
            tags: segments.tags,
            summary: segments.summary,
            headingPath: segments.headingPath,
          })
          .from(segments)
          .leftJoin(documents, eq(segments.documentId, documents.id)),
      { label: 'graph.nodes' },
    );

    const edges = await withDbRetry(
      () =>
        db
          .select({ source: links.fromId, target: links.toId, kind: links.kind, weight: links.weight })
          .from(links),
      { label: 'graph.edges' },
    );

    return {
      nodes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        memory: memoryOf(r.stability, r.lastViewedAt, now),
        viewCount: r.viewCount,
        readingMs: Number(r.readingMs),
        documentTitle: r.documentTitle,
        tags: r.tags,
        summary: r.summary,
        headingPath: r.headingPath,
      })),
      edges,
    };
  };

  try {
    const { value: payload, stale } = await withStaleFallback({
      cacheKey: CACHE_KEY,
      ttlMs: CACHE_TTL_MS,
      run: loadGraph,
      label: 'graph',
    });
    return NextResponse.json(payload, { headers: { 'X-Cache': stale ? 'STALE' : 'MISS' } });
  } catch {
    return dbUnavailable();
  }
}
