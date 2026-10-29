import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  result: { tokens: 0 } as { tokens: number } | null,
  error: null as Error | null,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            (state.error ? Promise.reject(state.error) : Promise.resolve(state.result ? [state.result] : []))
              .then(resolve, reject),
        }),
      }),
    }),
  },
}));

const { assertDailyTokenBudget, DAILY_TOKEN_GUARDRAIL } = await import('../llm-calls');

describe('assertDailyTokenBudget', () => {
  beforeEach(() => {
    state.result = { tokens: 0 };
    state.error = null;
  });

  it('未达到护栏时放行', async () => {
    state.result = { tokens: DAILY_TOKEN_GUARDRAIL - 1 };
    await expect(assertDailyTokenBudget()).resolves.toBeUndefined();
  });

  it('达到护栏时拒绝真实调用', async () => {
    state.result = { tokens: DAILY_TOKEN_GUARDRAIL };
    await expect(assertDailyTokenBudget()).rejects.toThrow(/超过.*护栏/);
  });

  it('无法读取用量时 fail-closed', async () => {
    state.error = new Error('db down');
    await expect(assertDailyTokenBudget()).rejects.toThrow(/停止调用/);
  });
});
