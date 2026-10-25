import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { annotations } from '@/db/schema';
import { guard, isUuid, notFound } from '@/lib/api';

/** 删除标注 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const deleted = await db.delete(annotations).where(eq(annotations.id, id)).returning({ id: annotations.id });
  if (deleted.length === 0) return notFound('标注不存在');
  return NextResponse.json({ ok: true });
}
