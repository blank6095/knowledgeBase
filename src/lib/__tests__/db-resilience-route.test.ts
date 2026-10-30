import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * 数据库瞬时不可用时的路由行为（不连真实数据库）。
 *
 * 覆盖两种结果：
 * 1. 无任何可用快照 → 503 + 中文可操作提示（前端展示可重试错误态）；
 * 2. 有上一次成功的快照 → 200 + X-Cache: STALE（页面继续可用，不整页报错）。
 */

type RowSet = { rows?: unknown[]; error?: Error };

const h = vi.hoisted(() => {
  const state = { pending: [] as RowSet[] };
  type Chain = Record<string, unknown>;
  const makeChain = (p: Promise<unknown[]>): Chain => {
    const chain: Chain = {};
    const self = () => chain;
    chain.from = self;
    chain.innerJoin = self;
    chain.leftJoin = self;
    chain.where = self;
    chain.groupBy = self;
    chain.orderBy = self;
    chain.limit = self;
    chain.then = (onFulfilled: (v: unknown[]) => unknown, onRejected: (e: unknown) => unknown) =>
      p.then(onFulfilled, onRejected);
    chain.catch = (onRejected: (e: unknown) => unknown) => makeChain(p.catch(onRejected) as Promise<unknown[]>);
    return chain;
  };
  const next = () => {
    const item = state.pending.shift();
    return makeChain(item?.error ? Promise.reject(item.error) : Promise.resolve(item?.rows ?? []));
  };
  return { state, next };
});

vi.mock('@/db', () => ({ db: { select: () => h.next() } }));

const { GET } = await import('@/app/api/stats/route');
const { clearAllCache, expireFreshEntries } = await import('@/lib/cache');

const PASSCODE = 'test-passcode';
const TOKEN = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');

function authedReq(): NextRequest {
  return { headers: new Headers({ cookie: `kb_session=${TOKEN}` }) } as unknown as NextRequest;
}

/** 与 Neon HTTP 一致的瞬时故障 */
function transientError(): Error {
  const cause = new AggregateError([Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })], 'all failed');
  return Object.assign(new TypeError('fetch failed'), { cause });
}

const OK_ROWS = [
  { rows: [] }, // weakTop3
  { rows: [] }, // unreadTop3
  { rows: [{ total: 15, unread: 4, weak: 11, medium: 0, strong: 0 }] },
  { rows: [{ count: 2 }] },
  { rows: [{ id: 'd1', title: '管道', segmentCount: 4, createdAt: new Date('2026-10-25T06:52:26.411Z') }] },
];

beforeAll(() => {
  // 缩短重试节奏，测试不做真实等待
  process.env.DB_RETRY_ATTEMPTS = '1';
  process.env.DB_RETRY_BASE_DELAY_MS = '0';
});

beforeEach(() => {
  process.env.AUTH_PASSCODE = PASSCODE;
  clearAllCache();
  h.state.pending = [];
});

describe('GET /api/stats · 数据库瞬时不可用', () => {
  it('无快照可用时返回 503 与中文提示（前端据此展示可重试错误态）', async () => {
    h.state.pending = Array.from({ length: 40 }, () => ({ error: transientError() }));

    const res = await GET(authedReq());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/数据库暂时不可用/);
  });

  it('有上一次成功的快照时返回 200 且标记 STALE（页面继续可用）', async () => {
    h.state.pending = [...OK_ROWS];
    const first = await GET(authedReq());
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');

    // 只让新鲜缓存过期，保留陈旧快照；随后数据库持续失败
    expireFreshEntries();
    h.state.pending = Array.from({ length: 40 }, () => ({ error: transientError() }));

    const second = await GET(authedReq());
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(second.headers.get('X-Cache')).toBe('STALE');
    expect(secondBody).toEqual(firstBody);
  });
});
