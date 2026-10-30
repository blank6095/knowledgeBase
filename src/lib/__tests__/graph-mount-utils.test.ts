import { describe, expect, it } from 'vitest';
import {
  TICK_COST_WORST,
  WARMUP_BUDGET_MS,
  manyBodyThetaFor,
  nodeInsideViewport,
  sizeChanged,
  warmupTicksFor,
} from '@/app/graph/mount-utils';

/**
 * 每 tick 成本：由 `node artifacts/measure-tick-cost.mjs` 实测产出
 * （artifacts/tick-cost-worst.json）：每轮每规模 4 次、共 3 轮，跨轮取最坏值。
 * cost(ticks) = 首个 tick + (ticks-1) × 中位 tick，用于校验预热预算。
 */
const cost = (firstMs: number, medianMs: number, ticks: number) => firstMs + Math.max(0, ticks - 1) * medianMs;

describe('manyBodyThetaFor：规模自适应', () => {
  it('随节点规模提高 theta，小图保持默认精度', () => {
    expect(manyBodyThetaFor(500)).toBe(0.9);
    expect(manyBodyThetaFor(2_000)).toBe(1.0);
    expect(manyBodyThetaFor(5_000)).toBe(1.2);
    expect(manyBodyThetaFor(20_000)).toBe(1.3);
  });
});

describe('nodeInsideViewport：视口剔除', () => {
  it('保留视口及光晕边界附近节点，剔除远处节点', () => {
    expect(nodeInsideViewport(100, 100, 800, 600, 20)).toBe(true);
    expect(nodeInsideViewport(-19, 100, 800, 600, 20)).toBe(true);
    expect(nodeInsideViewport(-21, 100, 800, 600, 20)).toBe(false);
    expect(nodeInsideViewport(900, 100, 800, 600, 20)).toBe(false);
  });
});

describe('warmupTicksFor：按节点规模自适应预热', () => {
  it('空图不预热', () => {
    expect(warmupTicksFor(0)).toBe(0);
  });

  it('小图用小档成本上界反推，且不超过预热上限', () => {
    expect(warmupTicksFor(1)).toBe(108);
    expect(warmupTicksFor(500)).toBe(108);
    // 600 节点按 1000 行（保守上界）计算，不沿用 500 行
    expect(warmupTicksFor(600)).toBe(warmupTicksFor(1000));
    expect(warmupTicksFor(600)).toBe(44);
  });

  it('规模越大预热越少，且单调不增', () => {
    const counts = [1, 500, 600, 1000, 1001, 2000, 2001, 3000, 3001, 5000, 5001, 8000, 20000];
    const ticks = counts.map(warmupTicksFor);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeLessThanOrEqual(ticks[i - 1]);
  });

  it('每个实测规模的预热同步成本都不超预算', () => {
    for (const { nodes, firstMs, medianMs } of TICK_COST_WORST) {
      expect(cost(firstMs, medianMs, warmupTicksFor(nodes))).toBeLessThanOrEqual(WARMUP_BUDGET_MS);
    }
  });

  it('档位之间的边界也按较大一档的成本上界计算，不超预算', () => {
    // 600 落在 500/1000 之间，实现取 1000 行成本 → 仍是预算内
    const [row1000] = TICK_COST_WORST.filter((r) => r.nodes === 1000);
    expect(cost(row1000.firstMs, row1000.medianMs, warmupTicksFor(600))).toBeLessThanOrEqual(WARMUP_BUDGET_MS);
    // 8000 以上沿用 8000 行（已知限制）
    const [row8000] = TICK_COST_WORST.filter((r) => r.nodes === 8000);
    expect(cost(row8000.firstMs, row8000.medianMs, warmupTicksFor(20000))).toBeLessThanOrEqual(WARMUP_BUDGET_MS);
  });

  it('大图只保留最低预热，不会退化为 0', () => {
    expect(warmupTicksFor(8000)).toBe(2);
    expect(warmupTicksFor(20000)).toBe(2);
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

  it('双向都能识别：缩小同样触发重设', () => {
    expect(sizeChanged({ w: 359, h: 542 }, { w: 357, h: 542 })).toBe(true);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 359, h: 540 })).toBe(true);
  });

  it('容差可配置', () => {
    expect(sizeChanged({ w: 359, h: 542 }, { w: 362, h: 542 }, 4)).toBe(false);
    expect(sizeChanged({ w: 359, h: 542 }, { w: 363, h: 542 }, 4)).toBe(true);
  });
});
