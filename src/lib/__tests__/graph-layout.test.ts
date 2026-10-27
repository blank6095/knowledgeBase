import { describe, expect, it } from 'vitest';
import { WARMUP_BUDGET_MS, sizeChanged, warmupTicksFor } from '@/app/graph/mount-utils';

/**
 * 每 tick 成本：取 4 次运行的最坏值（artifacts/tick-cost-worst.json），
 * cost(ticks) = 首个 tick + (ticks-1) × 中位；不用单次跑得最好看的数。
 */
const WORST_CASE = [
  { nodes: 500, firstMs: 30.8, medianMs: 1.59 },
  { nodes: 1000, firstMs: 13.6, medianMs: 3.16 },
  { nodes: 2000, firstMs: 9.1, medianMs: 7.62 },
  { nodes: 3000, firstMs: 12.0, medianMs: 11.56 },
  { nodes: 5000, firstMs: 39.8, medianMs: 31.01 },
  { nodes: 8000, firstMs: 92.3, medianMs: 53.81 },
];

describe('warmupTicksFor：按可见节点数自适应预热', () => {
  it('小图（≤600）用满预热，保证首帧收敛', () => {
    expect(warmupTicksFor(0)).toBe(0);
    expect(warmupTicksFor(1)).toBe(120);
    expect(warmupTicksFor(500)).toBe(120);
    expect(warmupTicksFor(600)).toBe(120);
  });

  it('中图逐级降低预热，落在预算内', () => {
    expect(warmupTicksFor(601)).toBe(30);
    expect(warmupTicksFor(2000)).toBe(30);
    expect(warmupTicksFor(2001)).toBe(20);
    expect(warmupTicksFor(3000)).toBe(20);
    expect(warmupTicksFor(3001)).toBe(6);
    expect(warmupTicksFor(6000)).toBe(6);
  });

  it('大图只保留最低预热', () => {
    expect(warmupTicksFor(6001)).toBe(3);
    expect(warmupTicksFor(8000)).toBe(3);
    expect(warmupTicksFor(20000)).toBe(3);
  });

  it('预热次数随节点数单调不增', () => {
    const counts = [1, 500, 601, 2000, 2001, 3000, 3001, 6000, 6001, 8000, 20000];
    const ticks = counts.map(warmupTicksFor);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeLessThanOrEqual(ticks[i - 1]);
  });

  it('最坏采样下每个规模点的预热同步成本都不超预算', () => {
    for (const { nodes, firstMs, medianMs } of WORST_CASE) {
      const ticks = warmupTicksFor(nodes);
      const cost = firstMs + Math.max(0, ticks - 1) * medianMs;
      expect(cost).toBeLessThanOrEqual(WARMUP_BUDGET_MS);
    }
  });
});

describe('sizeChanged：忽略 ±1px 抖动，避免画布反复重设', () => {
  it('首次测量一定视为变化', () => {
    expect(sizeChanged(null, { w: 359, h: 542 })).toBe(true);
  });

  it('1px 以内的抖动不触发重设（滚动条/亚像素）', () => {
    expect(sizeChanged({ w: 359, h: 542 }, { w: 359, h: 541 })).toBe(false);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 360, h: 542 })).toBe(false);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 359, h: 542 })).toBe(false);
  });

  it('达到 2px 视为真实变化（窗口/侧栏尺寸改变）', () => {
    expect(sizeChanged({ w: 359, h: 542 }, { w: 359, h: 544 })).toBe(true);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 361, h: 542 })).toBe(true);
  });

  it('容差可配置', () => {
    expect(sizeChanged({ w: 359, h: 542 }, { w: 362, h: 542 }, 4)).toBe(false);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 363, h: 542 }, 4)).toBe(true);
  });
});
