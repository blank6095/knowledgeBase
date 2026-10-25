import { describe, expect, it } from 'vitest';
import {
  applyReading,
  halfLifeDays,
  memoryColor,
  memoryOf,
  memoryTier,
  MEMORY,
  readingWeight,
} from '../memory';

const T0 = new Date('2026-10-25T10:00:00');
const DAY = 86_400_000;

function read(state: { stability: number; lastReadAt: Date | string | null }, durationMs: number, at: Date) {
  const stability = applyReading(state, durationMs, at);
  if (stability === null) throw new Error(`期望推进稳定度，实际被门槛过滤（${durationMs}ms）`);
  return { stability, lastReadAt: at };
}

describe('memoryOf 记忆度衰减', () => {
  it('从未阅读 → 记忆度为 0', () => {
    expect(memoryOf(0, null, T0)).toBe(0);
    expect(memoryOf(0, T0, T0)).toBe(0);
  });

  it('首读后 M>0，且随注入时间按 exp(-Δt/S) 指数衰减', () => {
    const { stability, lastReadAt } = read({ stability: 0, lastReadAt: null }, 180_000, T0);
    expect(stability).toBeCloseTo(0.8, 5);

    const m0 = memoryOf(stability, lastReadAt, T0);
    expect(m0).toBeCloseTo(1, 5);
    // Δt = S 时 M = e^-1
    const m1 = memoryOf(stability, lastReadAt, new Date(T0.getTime() + 0.8 * DAY));
    expect(m1).toBeCloseTo(Math.exp(-1), 3);
    // 指数衰减：等比关系 M(2Δt) = M(Δt)²
    const m2 = memoryOf(stability, lastReadAt, new Date(T0.getTime() + 1.6 * DAY));
    expect(m2).toBeCloseTo(m1 * m1, 3);
  });

  it('接受字符串日期（API 传输形态）', () => {
    const m = memoryOf(0.8, T0.toISOString(), new Date(T0.getTime() + 0.8 * DAY));
    expect(m).toBeCloseTo(Math.exp(-1), 3);
  });
});

describe('applyReading 稳定度推进', () => {
  it('首读：3 分钟全效 S=0.8；30 秒部分效 S=0.4', () => {
    expect(applyReading({ stability: 0, lastReadAt: null }, 180_000, T0)).toBeCloseTo(0.8, 5);
    expect(applyReading({ stability: 0, lastReadAt: null }, 30_000, T0)).toBeCloseTo(0.4, 5);
    expect(readingWeight(180_000)).toBe(1);
    expect(readingWeight(30_000)).toBe(0.2); // 低于 36 秒钳到下限
    expect(readingWeight(60_000)).toBeCloseTo(1 / 3, 5);
  });

  it('<5 秒不推进：返回 null，不写事件不更新 S', () => {
    expect(applyReading({ stability: 0, lastReadAt: null }, 4_999, T0)).toBeNull();
    expect(applyReading({ stability: 2, lastReadAt: T0 }, 0, T0)).toBeNull();
    expect(applyReading({ stability: 2, lastReadAt: T0 }, MEMORY.MIN_EVENT_MS, T0)).not.toBeNull();
  });

  it('间隔越远增幅越大：Δt/S 从 0.5 → 1 → 1.6 依次增长', () => {
    const base = { stability: 0.8, lastReadAt: T0 };
    const g05 = applyReading(base, 180_000, new Date(T0.getTime() + 0.4 * DAY))!; // growth 0.5
    const g10 = applyReading(base, 180_000, new Date(T0.getTime() + 0.8 * DAY))!; // growth 1
    const g16 = applyReading(base, 180_000, new Date(T0.getTime() + 1.28 * DAY))!; // growth 封顶 1.6
    expect(g05).toBeGreaterThan(0.8);
    expect(g10).toBeGreaterThan(g05);
    expect(g16).toBeGreaterThan(g10);
    // S ← S×(1+w×growth)+0.5w
    expect(g10).toBeCloseTo(0.8 * 2 + 0.5, 5);
    expect(g16).toBeCloseTo(0.8 * 2.6 + 0.5, 5);
  });

  it('增幅有封顶：Δt/S 超过 1.6 后不再增加', () => {
    const base = { stability: 0.8, lastReadAt: T0 };
    const atCap = applyReading(base, 180_000, new Date(T0.getTime() + 1.28 * DAY));
    const beyond = applyReading(base, 180_000, new Date(T0.getTime() + 8 * DAY));
    expect(beyond).toBeCloseTo(atCap!, 5);
  });

  it('单次时长超过 10 分钟按 10 分钟计（防挂机），权重封顶为 1', () => {
    expect(readingWeight(60 * 60_000)).toBe(1);
    expect(applyReading({ stability: 0, lastReadAt: null }, 60 * 60_000, T0)).toBeCloseTo(0.8, 5);
  });

  it('稳定度上限 365 天', () => {
    let s = { stability: 300, lastReadAt: T0 };
    for (let i = 0; i < 50; i++) {
      const next = applyReading(s, 180_000, new Date(T0.getTime() + (i + 1) * 300 * DAY));
      if (next === null) break;
      s = { stability: next, lastReadAt: new Date(T0.getTime() + (i + 1) * 300 * DAY) };
    }
    expect(s.stability).toBeLessThanOrEqual(MEMORY.STABILITY_CAP_DAYS);
    expect(s.stability).toBe(MEMORY.STABILITY_CAP_DAYS);
  });
});

describe('展示档位与配色', () => {
  it('半衰期 = S × ln2 天', () => {
    expect(halfLifeDays(0.8)).toBeCloseTo(0.8 * Math.LN2, 10);
  });

  it('档位边界：0 未读 / <0.4 弱 / 0.4–0.75 中 / ≥0.75 强', () => {
    expect(memoryTier(0)).toBe('unread');
    expect(memoryTier(0.39)).toBe('weak');
    expect(memoryTier(0.4)).toBe('medium');
    expect(memoryTier(0.749)).toBe('medium');
    expect(memoryTier(0.75)).toBe('strong');
  });

  it('memoryColor：未读灰，M∈(0,1] 随 M 单调变亮且更饱和', () => {
    expect(memoryColor(0)).toBe('#55504a');
    const hsl = (m: number) => {
      const match = memoryColor(m).match(/hsl\(38, (\d+)%, ([\d.]+)%\)/);
      if (!match) throw new Error(`非琥珀色系输出: ${memoryColor(m)}`);
      return { s: Number(match[1]), l: Number(match[2]) };
    };
    let prev = { s: -1, l: -1 };
    for (let i = 1; i <= 100; i++) {
      const cur = hsl(i / 100);
      expect(cur.l).toBeGreaterThan(prev.l);
      expect(cur.s).toBeGreaterThanOrEqual(prev.s);
      prev = cur;
    }
    // M=1 到达梯度上界：饱和度 70%、亮度 68%
    expect(hsl(1)).toEqual({ s: 70, l: 68 });
    expect(hsl(0.001).s).toBeGreaterThanOrEqual(45);
    expect(hsl(0.001).l).toBeGreaterThanOrEqual(32);
  });
});
