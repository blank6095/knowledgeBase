import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  segment: {
    id: '11111111-1111-4111-8111-111111111111',
    documentId: '22222222-2222-4222-8222-222222222222',
    stability: 0,
    lastViewedAt: null as Date | null,
  },
  inserted: [] as unknown[],
  batched: [] as unknown[],
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [state.segment],
      }),
    }),
    insert: () => ({
      values: async (value: unknown) => {
        state.inserted.push(value);
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
    batch: async (queries: unknown[]) => {
      state.batched = queries;
      return [];
    },
  },
}));

vi.mock('@/lib/cache', () => ({
  invalidateCache: vi.fn(),
}));

const { POST } = await import('@/app/api/segments/[id]/view/route');
const { invalidateCache } = await import('@/lib/cache');
const { MEMORY } = await import('@/lib/memory');

const PASSCODE = 'test-passcode';
const TOKEN = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');

function request(body: unknown): NextRequest {
  return {
    headers: new Headers({ cookie: `kb_session=${TOKEN}` }),
    json: async () => body,
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: state.segment.id }) };

describe('POST /api/segments/[id]/view', () => {
  beforeEach(() => {
    process.env.AUTH_PASSCODE = PASSCODE;
    state.segment.stability = 0;
    state.segment.lastViewedAt = null;
    state.inserted = [];
    state.batched = [];
    vi.mocked(invalidateCache).mockClear();
  });

  it('拒绝负数时长', async () => {
    const res = await POST(request({ durationMs: -1 }), params);
    expect(res.status).toBe(400);
    expect(state.batched).toHaveLength(0);
  });

  it('不足 5 秒不写阅读事件', async () => {
    const res = await POST(request({ durationMs: 4_999 }), params);
    expect(await res.json()).toEqual({ ok: true, counted: false });
    expect(state.batched).toHaveLength(0);
  });

  it('有效阅读将流水与记忆更新放入同一 batch，并失效关联缓存', async () => {
    const res = await POST(request({ durationMs: MEMORY.MAX_SESSION_MS + 60_000 }), params);
    expect(res.status).toBe(200);
    expect(state.batched).toHaveLength(2);
    expect(state.inserted).toEqual([
      expect.objectContaining({
        segmentId: state.segment.id,
        durationMs: MEMORY.MAX_SESSION_MS,
      }),
    ]);
    expect(invalidateCache).toHaveBeenCalledWith('docs');
    expect(invalidateCache).toHaveBeenCalledWith(`note:${state.segment.documentId}`);
  });
});
