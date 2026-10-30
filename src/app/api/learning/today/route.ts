import { NextRequest, NextResponse } from 'next/server';
import { dbUnavailable, guard } from '@/lib/api';
import { getTodayLearning } from '@/lib/learning-service';
import { withStaleFallback } from '@/lib/db-read';

/**
 * 今日学习：数据库抖动时回退到陈旧快照（推荐结果是缓存友好的，短暂陈旧可接受）。
 * 刻意不做「新鲜缓存」：推荐随复习行为即时变化，缓存会让用户看到过期推荐；
 * TTL=0 表示只保留 15 分钟的陈旧快照用于降级。
 */
const CACHE_KEY = 'learning-today';
const CACHE_TTL_MS = 0;

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  try {
    const { value, stale } = await withStaleFallback({
      cacheKey: CACHE_KEY,
      ttlMs: CACHE_TTL_MS,
      run: () => getTodayLearning(),
      label: 'learning.today',
    });
    return NextResponse.json(value, { headers: { 'X-Cache': stale ? 'STALE' : 'MISS' } });
  } catch {
    return dbUnavailable();
  }
}
