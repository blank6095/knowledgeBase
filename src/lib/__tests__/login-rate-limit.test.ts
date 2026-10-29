import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllLoginRateLimits,
  clearLoginFailures,
  loginRateLimit,
  recordLoginFailure,
} from '../login-rate-limit';

afterEach(clearAllLoginRateLimits);

describe('登录失败限流', () => {
  it('5 次失败后进入 10 分钟封禁', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordLoginFailure('ip', now);
    expect(loginRateLimit('ip', now).blocked).toBe(true);
    expect(loginRateLimit('ip', now).retryAfterSec).toBe(600);
    expect(loginRateLimit('other-ip', now).blocked).toBe(false);
  });

  it('窗口结束后自动恢复', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordLoginFailure('ip', now);
    expect(loginRateLimit('ip', now + 600_000).blocked).toBe(false);
  });

  it('成功登录清除失败记录', () => {
    recordLoginFailure('ip');
    clearLoginFailures('ip');
    expect(loginRateLimit('ip')).toEqual({ blocked: false, retryAfterSec: 0 });
  });
});
