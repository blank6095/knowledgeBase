import { NextRequest, NextResponse } from 'next/server';
import { dbUnavailable, guard } from '@/lib/api';
import { getWeeklyLearningReport } from '@/lib/learning-service';
import { withStaleFallback } from '@/lib/db-read';

/**
 * 学习复盘：数据库抖动时回退到陈旧快照，避免整页空白。
 * 与今日学习同理：数据随复习行为变化，不做新鲜缓存，仅保留陈旧快照用于降级。
 */
const CACHE_KEY = 'learning-weekly';
const CACHE_TTL_MS = 0;

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  try {
    const { value, stale } = await withStaleFallback({
      cacheKey: CACHE_KEY,
      ttlMs: CACHE_TTL_MS,
      run: () => getWeeklyLearningReport(),
      label: 'learning.weekly',
    });
    return NextResponse.json(value, { headers: { 'X-Cache': stale ? 'STALE' : 'MISS' } });
  } catch {
    return dbUnavailable();
  }
}
