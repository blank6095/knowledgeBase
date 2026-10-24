import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { guard } from '@/lib/api';


/**
 * 复习队列：默认返回到期（dueAt <= now）的知识点；
 * ?all=1 时包含未到期项（提前复习），按到期时间升序。
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const showAll = req.nextUrl.searchParams.get('all') === '1';
  const where = showAll ? undefined : and(lte(segments.dueAt, sql`now()`));

  const rows = await db
    .select({
      id: segments.id,
      title: segments.title,
      headingPath: segments.headingPath,
      status: segments.status,
      mastery: segments.mastery,
      dueAt: segments.dueAt,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id))
    .where(where)
    .orderBy(asc(segments.dueAt))
    .limit(50);

  const [{ dueCount }] = await db
    .select({ dueCount: sql<number>`count(*)::int` })
    .from(segments)
    .where(lte(segments.dueAt, sql`now()`));

  return NextResponse.json({ queue: rows, dueCount });
}
