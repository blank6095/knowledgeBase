import { describe, expect, it } from 'vitest';
import { readWithIdleTimeout } from '../stream-utils';

describe('readWithIdleTimeout', () => {
  it('正常 chunk 立即返回', async () => {
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    }).getReader();
    const result = await readWithIdleTimeout(reader, 100);
    expect(result.done).toBe(false);
    expect(Array.from(result.value ?? [])).toEqual([1, 2]);
  });

  it('静默超时会取消 reader', async () => {
    let cancelled = false;
    const reader = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }).getReader();
    await expect(readWithIdleTimeout(reader, 10)).rejects.toThrow(/静默/);
    expect(cancelled).toBe(true);
  });
});
