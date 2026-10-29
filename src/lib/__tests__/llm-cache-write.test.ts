import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onConflictDoUpdate: vi.fn(),
  onConflictDoNothing: vi.fn(),
  values: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    insert: mocks.insert,
    execute: mocks.execute,
  },
}));

import { saveCachedOutput } from '../llm-cache';

describe('saveCachedOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
    mocks.onConflictDoUpdate.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.execute.mockResolvedValue(undefined);
  });

  it('同 key 写入时覆盖旧输出并刷新过期时间与创建时间', async () => {
    const expiresAt = new Date('2026-10-30T00:00:00.000Z');

    await saveCachedOutput('hash-1', 'ask', 'model-2', { answer: '新答案' }, expiresAt);

    expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const update = mocks.onConflictDoUpdate.mock.calls[0][0];
    expect(update.set).toMatchObject({
      kind: 'ask',
      model: 'model-2',
      output: { answer: '新答案' },
      expiresAt,
    });
    expect(update.set.createdAt).toBeInstanceOf(Date);
    expect(mocks.onConflictDoNothing).not.toHaveBeenCalled();
  });

  it('无 TTL 时冲突更新会清空旧过期时间', async () => {
    await saveCachedOutput('hash-2', 'split', 'model-1', { children: [] });

    const update = mocks.onConflictDoUpdate.mock.calls[0][0];
    expect(update.set.expiresAt).toBeNull();
  });
});
