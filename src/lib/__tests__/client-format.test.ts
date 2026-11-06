import { describe, expect, it } from 'vitest';
import { ApiError, formatDate, isAuthError } from '@/lib/client';

/** T3 基座：401 可被组件识别（api() 会同时跳登录），不再只是裸 Error */
describe('ApiError / isAuthError', () => {
  it('保留状态码并识别 401 为会话失效', () => {
    const error = new ApiError('未登录', 401);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(isAuthError(error)).toBe(true);
  });

  it('其他状态码不算会话失效', () => {
    expect(isAuthError(new ApiError('请求失败（500）', 500))).toBe(false);
    expect(isAuthError(new Error('未登录'))).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

/** UX-34①：跨年日期要带年份，同年保持简洁 */
describe('formatDate 跨年补年份', () => {
  const now = new Date('2026-11-02T10:00:00+08:00');

  it('同年只显示月日与时分', () => {
    const text = formatDate('2026-03-05T09:30:00+08:00', now);
    expect(text).not.toContain('2026');
    expect(text).toContain('3');
  });

  it('跨年补上年份', () => {
    const text = formatDate('2025-12-31T09:30:00+08:00', now);
    expect(text).toContain('2025');
  });

  it('空值与非法值仍返回占位符', () => {
    expect(formatDate(null, now)).toBe('—');
    expect(formatDate(undefined, now)).toBe('—');
    expect(formatDate('not-a-date', now)).toBe('—');
  });
});
