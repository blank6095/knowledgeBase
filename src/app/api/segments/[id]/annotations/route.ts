import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { annotations, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { MIN_QUOTE_LEN, type AnnotationColor, type AnnotationKind } from '@/lib/annotations';

const COLORS: AnnotationColor[] = ['amber', 'amberDeep', 'neutral'];
const KINDS: AnnotationKind[] = ['highlight', 'note'];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const rows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.segmentId, id))
    .orderBy(asc(annotations.createdAt));
  return NextResponse.json({ annotations: rows });
}

/**
 * 创建标注：highlight 必须带引文；note 可带引文（选区笔记）或不带（节级笔记）。
 * 锚点字段（quote/occurrence/prefix/suffix）由前端按段渲染文本计算。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const [seg] = await db.select({ id: segments.id }).from(segments).where(eq(segments.id, id));
  if (!seg) return notFound('知识点不存在');

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    quote?: string;
    occurrence?: number;
    prefix?: string;
    suffix?: string;
    note?: string;
    color?: string;
  };

  const kind = body.kind as AnnotationKind;
  if (!KINDS.includes(kind)) return badRequest('kind 必须是 highlight/note');
  const color = (body.color ?? 'amber') as AnnotationColor;
  if (!COLORS.includes(color)) return badRequest('不支持的标注颜色');

  const quote = (body.quote ?? '').trim();
  if (kind === 'highlight' && quote.length < MIN_QUOTE_LEN) return badRequest('划线引文过短');
  if (kind === 'note' && !quote && !(body.note ?? '').trim()) return badRequest('笔记内容不能为空');

  const [row] = await db
    .insert(annotations)
    .values({
      segmentId: id,
      kind,
      quote: quote || null,
      occurrence: Math.max(1, Number.isInteger(body.occurrence) ? (body.occurrence as number) : 1),
      prefix: (body.prefix ?? '').slice(0, 40) || null,
      suffix: (body.suffix ?? '').slice(0, 40) || null,
      note: (body.note ?? '').trim() || null,
      color,
    })
    .returning();
  return NextResponse.json({ annotation: row });
}
