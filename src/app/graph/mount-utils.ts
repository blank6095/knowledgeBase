/**
 * 图谱首帧相关的纯函数（便于单测，不依赖 DOM / 第三方库）。
 */

/**
 * 实测最坏 tick 成本（每次运行取最坏值）。
 * 采集方式：`node artifacts/measure-tick-cost.mjs > artifacts/tick-cost-worst.json`
 * —— d3-force-3d 3.0.6，forceLink/forceManyBody/forceCenter 默认参数，每规模 4 次。
 *
 * 节点数 ｜ 首 tick ｜ 中位 tick
 * 500    ｜  2.10ms ｜  1.69ms
 * 1000   ｜  4.50ms ｜  4.65ms
 * 2000   ｜ 10.80ms ｜ 10.86ms
 * 3000   ｜ 16.40ms ｜ 16.70ms
 * 5000   ｜ 31.00ms ｜ 31.79ms
 * 8000   ｜ 55.00ms ｜ 55.56ms
 */
export const TICK_COST_WORST = [
  { nodes: 500, firstMs: 2.1, medianMs: 1.69 },
  { nodes: 1000, firstMs: 4.5, medianMs: 4.65 },
  { nodes: 2000, firstMs: 10.8, medianMs: 10.86 },
  { nodes: 3000, firstMs: 16.4, medianMs: 16.7 },
  { nodes: 5000, firstMs: 31, medianMs: 31.79 },
  { nodes: 8000, firstMs: 55, medianMs: 55.56 },
] as const;

/**
 * 预热预算：用「首个 tick 成本 + (n-1) × 中位成本」估算同步开销，上限 250ms。
 *
 * 为什么按预算而不是按收敛程度定 tick 数：force-graph 的 warmupTicks 在每次 update
 * 时同步跑完，大图要在同步阶段收敛需要秒级预算（5000 节点约 200 tick ≈ 6s），
 * 那本身就是长任务。因此预热只负责「首帧不要明显比最终布局离谱」，真正收敛交给
 * 引擎按 d3AlphaMin 继续跑（见 page.tsx 的 CONVERGE_ALPHA_MIN），而不是硬停。
 */
export const WARMUP_BUDGET_MS = 250;

/** 小图预热上限：再多收益递减，且会白白增加首帧阻塞 */
const MAX_WARMUP_TICKS = 120;

/**
 * 布局收敛阈值：alpha 降到该值以下引擎才停。
 *
 * 不用 cooldownTicks 固定帧数硬停：实测 5000 节点预热 7 次后 alpha≈0.85，
 * 60 帧后 alpha 仍在 0.23 左右（平均残余位移约 900px），硬停会把布局冻结在
 * 半成品状态。改用 d3AlphaMin 让引擎按自身衰减跑到收敛再自停。
 *
 * 取值必须落在 (0, 1)：0 退化为「永不按 alpha 停」，1 会立即停。
 */
export const CONVERGE_ALPHA_MIN = 0.01;

/** 容器长时间测不出尺寸时的兜底尺寸（仅用于解锁挂载，不参与常规路径） */
export const FALLBACK_SIZE = { w: 900, h: 560 };
/** 兜底触发延时：正常测量在首帧内完成，留出 300ms 给隐藏/过渡态恢复 */
export const FALLBACK_MEASURE_MS = 300;

/**
 * 首帧预热迭代数：取「不小于当前规模的实测行」的成本上界，按预算反推 tick 数。
 * 用上界行（而不是就近插值）是保守做法：规模介于两行之间时按更大的那档算成本，
 * 只会让实际耗时更低于预算。
 *
 * 结果：500→120、1000→53、2000→22、3000→14、5000→7、8000→4（>8000 沿用 8000 档，
 * 属已知限制：未实测更大规模的每 tick 成本）。
 */
export function warmupTicksFor(nodeCount: number): number {
  if (nodeCount <= 0) return 0;
  const row = TICK_COST_WORST.find((candidate) => nodeCount <= candidate.nodes) ?? TICK_COST_WORST[TICK_COST_WORST.length - 1];
  const ticks = Math.floor((WARMUP_BUDGET_MS - row.firstMs) / row.medianMs) + 1;
  return Math.min(MAX_WARMUP_TICKS, Math.max(1, ticks));
}

/**
 * 尺寸是否发生“值得重设画布”的变化。
 * ResizeObserver 会因滚动条/亚像素给出 ±1px 抖动，这种变化重设画布只会造成闪烁，
 * 因此小于 tolerance 的变化一律视为未变；首次（prev 为 null）恒为变化。
 */
export function sizeChanged(
  prev: { w: number; h: number } | null,
  next: { w: number; h: number },
  tolerance = 2,
): boolean {
  if (!prev) return true;
  return Math.abs(prev.w - next.w) >= tolerance || Math.abs(prev.h - next.h) >= tolerance;
}
