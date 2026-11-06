import { describe, expect, it } from 'vitest';
import { estimateTodayDuration } from '@/components/TodayLearningPanel';

describe('今日学习时长估算（UX-34②）', () => {
  it('0 条不展示（返回 null），空态不再给出假时长', () => {
    expect(estimateTodayDuration(0)).toBeNull();
    expect(estimateTodayDuration(-1)).toBeNull();
    expect(estimateTodayDuration(Number.NaN)).toBeNull();
  });

  it('按「每条约 2–3 分钟」汇总区间', () => {
    expect(estimateTodayDuration(1)).toBe('约 2–3 分钟');
    expect(estimateTodayDuration(3)).toBe('约 6–9 分钟');
    expect(estimateTodayDuration(5)).toBe('约 10–15 分钟');
  });

  it('超过 1 小时换算为小时，保留一位小数', () => {
    expect(estimateTodayDuration(20)).toBe('约 40–60 分钟');
    expect(estimateTodayDuration(30)).toBe('约 1–1.5 小时');
    expect(estimateTodayDuration(60)).toBe('约 2–3 小时');
  });
});
