import { describe, expect, it } from 'vitest';
import { APP_TIME_ZONE, startOfDayInTimeZone } from '@/lib/day-boundary';

/**
 * 「今日」时区边界。
 *
 * 背景：服务端运行时通常是 UTC，`new Date().setHours(0,0,0,0)` 得到的是 UTC 零点，
 * 比 Asia/Shanghai 早 8 小时——「今日阅读数」「今日 token 用量」会在每天北京时间
 * 08:00 就翻页，且与 learning-plan.ts 已采用的 Asia/Shanghai 口径不一致。
 */
describe('startOfDayInTimeZone', () => {
  /** 把结果格式回目标时区，便于断言「落在当天 00:00」 */
  const wallClock = (d: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .format(d)
      .replace(',', '');

  const wallClockDay = (d: Date, timeZone: string): string => wallClock(d, timeZone).slice(0, 10);

  it('默认时区与 learning-plan.ts 的口径一致（Asia/Shanghai）', () => {
    expect(APP_TIME_ZONE).toBe('Asia/Shanghai');
  });

  it('边界落在目标时区的当天 00:00:00', () => {
    const now = new Date('2026-11-04T03:00:00Z'); // 北京 11:00
    const boundary = startOfDayInTimeZone(now);
    expect(wallClock(boundary, APP_TIME_ZONE)).toBe('2026-11-04 00:00:00');
  });

  it('刚过北京时间零点时归入新的一天', () => {
    // UTC 11-03 16:30 = 北京 11-04 00:30
    const now = new Date('2026-11-03T16:30:00Z');
    const boundary = startOfDayInTimeZone(now);
    expect(wallClockDay(boundary, APP_TIME_ZONE)).toBe('2026-11-04');
    expect(wallClock(boundary, APP_TIME_ZONE)).toBe('2026-11-04 00:00:00');
  });

  it('未过北京时间零点时仍归入前一天', () => {
    // UTC 11-03 15:59 = 北京 11-03 23:59
    const now = new Date('2026-11-03T15:59:00Z');
    const boundary = startOfDayInTimeZone(now);
    expect(wallClockDay(boundary, APP_TIME_ZONE)).toBe('2026-11-03');
    expect(wallClock(boundary, APP_TIME_ZONE)).toBe('2026-11-03 00:00:00');
  });

  it('UTC 口径下与旧的 setHours(0,0,0,0) 一致（行为未变）', () => {
    const now = new Date('2026-11-04T03:00:00Z');
    const boundary = startOfDayInTimeZone(now, 'UTC');
    expect(boundary.toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });

  it('夏令时地区按当天的实际偏移计算（不是固定 8 小时）', () => {
    // 纽约 2026-03-08 起进入夏令时；偏移在 3/7 与 3/9 不同
    const beforeDst = new Date('2026-03-07T16:30:00Z');
    const afterDst = new Date('2026-03-09T16:30:00Z');
    const a = startOfDayInTimeZone(beforeDst, 'America/New_York');
    const b = startOfDayInTimeZone(afterDst, 'America/New_York');
    expect(wallClock(a, 'America/New_York')).toBe('2026-03-07 00:00:00');
    expect(wallClock(b, 'America/New_York')).toBe('2026-03-09 00:00:00');
    // 两个边界的 UTC 偏移相差 1 小时（DST 切换的证据）
    expect(b.getTime() - a.getTime()).toBe(2 * 24 * 3600_000 - 3600_000);
  });

  it('结果一定是过去的某个时刻（不会把未来算进「今日」）', () => {
    const now = new Date('2026-11-04T03:00:00Z');
    expect(startOfDayInTimeZone(now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});
