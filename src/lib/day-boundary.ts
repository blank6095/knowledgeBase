/**
 * 「今日」的时区边界。
 *
 * 为什么需要：
 * - 服务端（Vercel / 容器）运行时通常是 UTC，而产品面向中文用户，
 *   `new Date().setHours(0,0,0,0)` 得到的是 UTC 零点——比用户所在的
 *   Asia/Shanghai 早 8 小时，导致「今日阅读数」「今日 token 用量」在
 *   每天 08:00（北京时间）就翻页，且与 learning-plan.ts 已采用的
 *   Asia/Shanghai 口径不一致；
 * - 本模块把口径收敛到一处，与 learning-plan.ts 的 learningDayKey 对齐。
 */

/** 业务时区：与 learning-plan.ts 的 learningDayKey 默认值保持一致 */
export const APP_TIME_ZONE = 'Asia/Shanghai';

/**
 * 某时刻在目标时区的挂钟时间偏移（毫秒）：挂钟时间 - UTC 时间。
 *
 * 做法：把目标时区的挂钟字段当成 UTC 字段构造一个 Date，再与原时刻相减。
 * 该值会随日期变化（DST），因此必须针对「目标时刻」求值，不能用固定偏移。
 */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wallClockAsUtc - at.getTime();
}

/**
 * 业务时区下「今日 00:00」对应的 UTC 时刻。
 *
 * 不能用「UTC 零点减 8 小时」这种固定偏移——时区有 DST，偏移量会随日期变化。
 *
 * @param now 当前时刻（默认取系统时间）
 * @param timeZone 目标时区
 * @returns 目标时区当天的 00:00 对应的 UTC Date
 */
export function startOfDayInTimeZone(now: Date = new Date(), timeZone: string = APP_TIME_ZONE): Date {
  const offset = timeZoneOffsetMs(now, timeZone);
  // 换算成目标时区的挂钟时间（以 UTC 字段表示），取其日历日零点
  const wallClock = new Date(now.getTime() + offset);
  const midnightWallClock = Date.UTC(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
  );
  // 再按同一偏移换回真实 UTC 时刻
  return new Date(midnightWallClock - offset);
}
