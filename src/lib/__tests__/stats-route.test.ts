import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * /api/stats 路由级用例（不连数据库）。
 *
 * db.select 被替换成按调用顺序取预设结果的 thenable 链：
 * 路由的调用顺序固定为 ① weakTop3 查询 ② unreadTop3 查询
 * ③ 档位聚合 ④ 今日阅读数 ⑤ 最近导入，因此用队列逐条喂结果。
 */

type RowSet = { rows?: unknown[]; error?: Error };

const h = vi.hoisted(() => {
  const state = { pending: [] as RowSet[], selectCalls: 0 };
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
    state.selectCalls += 1;
    return makeChain(item?.error ? Promise.reject(item.error) : Promise.resolve(item?.rows ?? []));
  };
  return { state, next };
});

vi.mock('@/db', () => ({ db: { select: () => h.next() } }));

const { GET } = await import('@/app/api/stats/route');
const { clearAllCache, invalidateCache } = await import('@/lib/cache');

const PASSCODE = 'test-passcode';
const TOKEN = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');

function authedReq(): NextRequest {
  return { headers: new Headers({ cookie: `kb_session=${TOKEN}` }) } as unknown as NextRequest;
}

function anonReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

const WEAK_ROWS = [
  { id: 's1', title: 'TCP 与 UDP', memory: 0.1683, degree: 6 },
  { id: 's2', title: 'OSI 七层模型', memory: 0.1311, degree: 5 },
];
const UNREAD_ROWS = [
  {
    segmentId: 'u1',
    title: '请求对象通配符',
    documentId: 'd1',
    documentTitle: '管道',
    createdAt: new Date('2026-10-25T06:52:26.411Z'),
  },
];
const TIER_ROWS = [{ total: 15, unread: 4, weak: 11, medium: 0, strong: 0 }];
const TODAY_ROWS = [{ count: 2 }];
const RECENT_ROWS = [
  { id: 'd1', title: '管道', segmentCount: 4, createdAt: new Date('2026-10-25T06:52:26.411Z') },
];

function enqueueFull(): void {
  h.state.pending = [
    { rows: WEAK_ROWS },
    { rows: UNREAD_ROWS },
    { rows: TIER_ROWS },
    { rows: TODAY_ROWS },
    { rows: RECENT_ROWS },
  ];
}

function enqueueEmpty(): void {
  h.state.pending = [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
}

beforeEach(() => {
  process.env.AUTH_PASSCODE = PASSCODE;
  clearAllCache();
  h.state.pending = [];
  h.state.selectCalls = 0;
});

describe('GET /api/stats', () => {
  it('未登录返回 401，且不查库、不带 X-Cache', async () => {
    const res = await GET(anonReq());
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Cache')).toBeNull();
    expect(h.state.selectCalls).toBe(0);
  });

  it('首次请求 MISS：返回全部旧字段与新增 weakTop3/unreadTop3', async () => {
    enqueueFull();
    const res = await GET(authedReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('MISS');
    expect(res.headers.get('Server-Timing')).toContain('db;dur=');
    expect(h.state.selectCalls).toBe(5);

    // 旧字段保持原语义
    expect(body.total).toBe(15);
    expect(body.byTier).toEqual({ unread: 4, weak: 11, medium: 0, strong: 0 });
    expect(body.tierOrder).toEqual(['unread', 'weak', 'medium', 'strong']);
    expect(body.readToday).toBe(2);
    expect(body.recentDocuments).toHaveLength(1);

    // weakTop3：memory 四舍五入到两位；suggestion 与首项完全同源
    expect(body.weakTop3).toEqual([
      { segmentId: 's1', title: 'TCP 与 UDP', memory: 0.17, degree: 6 },
      { segmentId: 's2', title: 'OSI 七层模型', memory: 0.13, degree: 5 },
    ]);
    expect(body.suggestion).toEqual(body.weakTop3[0]);

    // unreadTop3：日期序列化为 ISO 字符串
    expect(body.unreadTop3).toEqual([
      {
        segmentId: 'u1',
        title: '请求对象通配符',
        documentId: 'd1',
        documentTitle: '管道',
        createdAt: '2026-10-25T06:52:26.411Z',
      },
    ]);
  });

  it('第二次请求 HIT：跳过全部查询且响应体与 MISS 完全一致', async () => {
    enqueueFull();
    const first = await GET(authedReq());
    const firstBody = await first.json();
    const missCalls = h.state.selectCalls;

    const second = await GET(authedReq());
    const secondBody = await second.json();

    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(second.headers.get('Server-Timing')).toBe('cache;dur=0');
    expect(h.state.selectCalls).toBe(missCalls);
    expect(secondBody).toEqual(firstBody);
  });

  it('空库：weakTop3/unreadTop3 为空数组、suggestion 为 null，计数回落 0', async () => {
    enqueueEmpty();
    const res = await GET(authedReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.byTier).toEqual({ unread: 0, weak: 0, medium: 0, strong: 0 });
    expect(body.recentDocuments).toEqual([]);
    expect(body.weakTop3).toEqual([]);
    expect(body.suggestion).toBeNull();
    expect(body.unreadTop3).toEqual([]);
  });

  it('薄弱查询失败时降级为空清单，不影响其余统计', async () => {
    h.state.pending = [{ error: new Error('db down') }, { rows: UNREAD_ROWS }, { rows: TIER_ROWS }, { rows: TODAY_ROWS }, { rows: RECENT_ROWS }];
    const res = await GET(authedReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.weakTop3).toEqual([]);
    expect(body.suggestion).toBeNull();
    expect(body.total).toBe(15);
    expect(body.unreadTop3).toHaveLength(1);
  });

  it('未读精选查询失败时也降级为空清单', async () => {
    h.state.pending = [
      { rows: WEAK_ROWS },
      { error: new Error('db down') },
      { rows: TIER_ROWS },
      { rows: TODAY_ROWS },
      { rows: RECENT_ROWS },
    ];
    const res = await GET(authedReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unreadTop3).toEqual([]);
    expect(body.weakTop3).toHaveLength(2);
  });

  it('失效后重新 MISS：invalidateCache(stats) 让下一次请求重新查库', async () => {
    enqueueFull();
    await GET(authedReq());
    expect(h.state.selectCalls).toBe(5);

    invalidateCache('stats');
    enqueueFull();
    const res = await GET(authedReq());

    expect(res.headers.get('X-Cache')).toBe('MISS');
    expect(h.state.selectCalls).toBe(10);
  });
});
