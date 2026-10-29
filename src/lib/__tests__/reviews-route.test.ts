import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { sourceVersion } from '../learning-plan';

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertRows: [] as unknown[][],
  insertedValues: null as Record<string, unknown> | null,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => state.selectQueue.shift() ?? [],
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.insertedValues = values;
        return {
          onConflictDoNothing: () => ({
            returning: async () => state.insertRows.shift() ?? [],
          }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/cache', () => ({ invalidateCache: vi.fn() }));

const { POST } = await import('@/app/api/learning/reviews/route');

const PASSCODE = 'test-passcode';
const TOKEN = createHash('sha256').update(`kb-v1:${PASSCODE}`).digest('hex');
const SEGMENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const TITLE = 'HashMap';
const CONTENT = '使用数组、链表与红黑树处理冲突。';
const VERSION = sourceVersion(TITLE, CONTENT);

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return {
    headers: new Headers({ cookie: `kb_session=${TOKEN}` }),
    json: async () => ({
      submissionId: SUBMISSION_ID,
      segmentId: SEGMENT_ID,
      question: 'HashMap 如何解决冲突？',
      referenceAnswer: CONTENT,
      answer: '使用数组和链表，必要时转红黑树。',
      result: 'correct',
      sourceVersion: VERSION,
      ...overrides,
    }),
  } as unknown as NextRequest;
}

describe('POST /api/learning/reviews', () => {
  beforeEach(() => {
    process.env.AUTH_PASSCODE = PASSCODE;
    state.selectQueue = [];
    state.insertRows = [];
    state.insertedValues = null;
  });

  it('答对但回答为空时拒绝提交', async () => {
    const res = await POST(request({ answer: '' }));
    expect(res.status).toBe(400);
  });

  it('内容版本不一致时返回 409', async () => {
    state.selectQueue = [[], [{ id: SEGMENT_ID, title: TITLE, content: CONTENT }]];
    const res = await POST(request({ sourceVersion: '0'.repeat(64) }));
    expect(res.status).toBe(409);
  });

  it('成功写入并计算下一次复习时间', async () => {
    const row = { id: 'review-1', nextReviewAt: new Date('2026-11-05T00:00:00.000Z') };
    state.selectQueue = [[], [{ id: SEGMENT_ID, title: TITLE, content: CONTENT }]];
    state.insertRows = [[row]];
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      review: { id: row.id, nextReviewAt: row.nextReviewAt.toISOString() },
      duplicate: false,
    });
    expect(state.insertedValues).toMatchObject({ submissionId: SUBMISSION_ID, result: 'correct' });
    const reviewedAt = state.insertedValues?.reviewedAt as Date;
    const nextReviewAt = state.insertedValues?.nextReviewAt as Date;
    expect(nextReviewAt.getTime() - reviewedAt.getTime()).toBe(7 * 24 * 3600_000);
  });

  it('重复 submissionId 直接返回原记录', async () => {
    const existing = { id: 'review-existing', submissionId: SUBMISSION_ID };
    state.selectQueue = [[existing]];
    const res = await POST(request({ answer: '不同内容也不会重复写入' }));
    expect(await res.json()).toEqual({ review: existing, duplicate: true });
    expect(state.insertedValues).toBeNull();
  });
});
