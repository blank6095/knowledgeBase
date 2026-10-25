import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { deriveLearnerProfile, getLearnerDeclaration } from '@/lib/learner-profile';

/** 前端画像数据（/ask 预设问题、设置页展示）；无业务写入 */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const [profile, declaration] = await Promise.all([
    deriveLearnerProfile().catch(() => null),
    getLearnerDeclaration().catch(() => ''),
  ]);
  return NextResponse.json({ profile, declaration });
}
