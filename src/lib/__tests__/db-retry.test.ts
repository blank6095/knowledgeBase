import { describe, expect, it, vi } from 'vitest';
import { describeDbError, isTransientDbError, withDbRetry } from '@/lib/db-retry';

/** 构造与 Neon HTTP 驱动一致的瞬时故障：Error('fetch failed') + cause AggregateError(ETIMEDOUT) */
function neonTimeoutError(): Error {
  const cause = new AggregateError([Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })], 'all failed');
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('isTransientDbError', () => {
  it('识别 Neon 的 fetch failed + ETIMEDOUT 链路', () => {
    expect(isTransientDbError(neonTimeoutError())).toBe(true);
  });

  it('识别常见瞬时错误码', () => {
    expect(isTransientDbError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientDbError(new Error('socket hang up'))).toBe(true);
  });

  it('配置类错误不可重试（DNS / 证书 / 权限）', () => {
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    });
    expect(isTransientDbError(dns)).toBe(false);
    expect(isTransientDbError(Object.assign(new Error('cert'), { code: 'CERT_HAS_EXPIRED' }))).toBe(false);
  });

  it('普通业务错误不算瞬时故障', () => {
    expect(isTransientDbError(new Error('db down'))).toBe(false);
    expect(isTransientDbError(new Error('密码认证失败'))).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError('boom')).toBe(false);
  });
});

describe('describeDbError', () => {
  it('输出可读的一行原因', () => {
    expect(describeDbError(neonTimeoutError())).toMatch(/ETIMEDOUT|fetch failed/);
    expect(describeDbError(new Error('普通错误'))).toContain('普通错误');
  });

  it('优先暴露根因，而不是外层包装文案', () => {
    const wrapped = Object.assign(new Error('Failed query: select * from segments'), {
      cause: neonTimeoutError(),
    });
    expect(describeDbError(wrapped)).toBe('ETIMEDOUT: fetch failed');
  });
});

describe('withDbRetry', () => {
  it('瞬时故障重试后成功：结果原样返回', async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw neonTimeoutError();
        return 'ok';
      },
      { retries: 2, baseDelayMs: 0 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('非瞬时错误立即上抛，不做无谓重试', async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls += 1;
          throw new Error('db down');
        },
        { retries: 3, baseDelayMs: 0 },
      ),
    ).rejects.toThrow('db down');
    expect(calls).toBe(1);
  });

  it('重试耗尽后抛出最后一次错误', async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls += 1;
          throw neonTimeoutError();
        },
        { retries: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3); // 首次 + 2 次重试
  });

  it('retries=0 时只执行一次', async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls += 1;
          throw neonTimeoutError();
        },
        { retries: 0 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('退避会等待（默认基线 250ms）', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = withDbRetry(
        async () => {
          calls += 1;
          if (calls < 2) throw neonTimeoutError();
          return 'ok';
        },
        { retries: 1, baseDelayMs: 250 },
      );
      await vi.advanceTimersByTimeAsync(400);
      await expect(promise).resolves.toBe('ok');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
