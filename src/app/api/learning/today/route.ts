import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { getTodayLearning } from '@/lib/learning-service';

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return NextResponse.json(await getTodayLearning());
}
