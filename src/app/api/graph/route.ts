import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, links, segments } from '@/db/schema';
import { guard } from '@/lib/api';
import { getCache, setCache } from '@/lib/cache';
import { memoryOf } from '@/lib/memory';

const CACHE_KEY = 'graph';
const CACHE_TTL_MS = 60_000;

interface GraphNode {
  id: string;
  title: string;
  memory: number;
  stability: number;
  viewCount: number;
  readingMs: number;
  tags: string[];
  documentId: string;
  documentTitle: string | null;
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: { source: string; target: string; kind: string; weight: number }[];
}

/** 关系图谱数据：节点=知识点（记忆度读取时现算），边=关联（wiki/tag/doc） */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const cached = getCache<GraphPayload>(CACHE_KEY);
  if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });

  const now = new Date();
  const rows = await db
    .select({
      id: segments.id,
      title: segments.title,
      viewCount: segments.viewCount,
      stability: segments.stability,
      readingMs: segments.readingMs,
      lastViewedAt: segments.lastViewedAt,
      tags: segments.tags,
      documentId: segments.documentId,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id));

  const nodes = rows.map((r) => ({
    id: r.id,
    title: r.title,
    memory: memoryOf(r.stability, r.lastViewedAt, now),
    stability: r.stability,
    viewCount: r.viewCount,
    readingMs: Number(r.readingMs),
    tags: r.tags,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
  }));

  const edges = await db
    .select({ source: links.fromId, target: links.toId, kind: links.kind, weight: links.weight })
    .from(links);

  const payload: GraphPayload = { nodes, edges };
  setCache(CACHE_KEY, payload, CACHE_TTL_MS);
  return NextResponse.json(payload, { headers: { 'X-Cache': 'MISS' } });
}
