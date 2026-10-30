/**
 * 图谱首帧相关的纯函数（便于单测，不依赖 DOM / 第三方库）。
 */

/**
 * 实测最坏 tick 成本（每轮每规模 4 次、共 3 轮，跨轮取最坏值）。
 * 采集方式：`node artifacts/measure-tick-cost.mjs`（直接以 UTF-8 写
 * artifacts/tick-cost-worst.json）—— d3-force-3d 3.0.6，forceLink/forceManyBody/
 * forceCenter 默认参数。
 *
 * 节点数 ｜ 首 tick ｜ 中位 tick
 * 500    ｜  2.80ms ｜  1.84ms
 * 1000   ｜  4.25ms ｜  4.53ms
 * 2000   ｜ 11.15ms ｜ 10.39ms
 * 3000   ｜ 16.52ms ｜ 16.31ms
 * 5000   ｜ 31.30ms ｜ 30.87ms
 * 8000   ｜138.83ms ｜ 55.84ms
 */
export const TICK_COST_WORST = [
  { nodes: 500, firstMs: 2.8, medianMs: 1.84 },
  { nodes: 1000, firstMs: 4.25, medianMs: 4.53 },
  { nodes: 2000, firstMs: 11.15, medianMs: 10.39 },
  { nodes: 3000, firstMs: 16.52, medianMs: 16.31 },
  { nodes: 5000, firstMs: 31.3, medianMs: 30.87 },
  { nodes: 8000, firstMs: 138.83, medianMs: 55.84 },
] as const;

/**
 * 预热预算：用「首个 tick 成本 + (n-1) × 中位成本」估算同步开销，上限 200ms。
 *
 * 取 200 而不是贴着 250：跨运行实测波动可达 1.5 倍以上（同一规模同一台机器），
 * 贴着上限会让重测时立刻超预算。这里留出的余量用于吸收这类波动。
 *
 * 为什么按预算而不是按收敛程度定 tick 数：force-graph 的 warmupTicks 在每次 update
 * 时同步跑完，大图要在同步阶段收敛需要秒级预算（5000 节点约 200 tick ≈ 6s），
 * 那本身就是长任务。因此预热只负责「首帧不要明显比最终布局离谱」，真正收敛交给
 * 引擎按 d3AlphaMin 继续跑（见 page.tsx 的 CONVERGE_ALPHA_MIN），而不是硬停。
 */
export const WARMUP_BUDGET_MS = 200;

/** 小图预热上限：再多收益递减，且会白白增加首帧阻塞 */
const MAX_WARMUP_TICKS = 120;

/**
 * 布局收敛阈值：alpha 降到该值以下引擎才停。
 *
 * 不用 cooldownTicks 固定帧数硬停：实测 5000 节点预热 6 次后 alpha≈0.87，
 * 再跑 60 帧 alpha 仍在 0.22 左右（平均残余位移数百 px），硬停会把布局冻结在
 * 半成品状态。改用 d3AlphaMin 让引擎按自身衰减跑到收敛再自停。
 *
 * 取值必须落在 (0, 1)：0 退化为「永不按 alpha 停」，1 会立即停。
 */
export const CONVERGE_ALPHA_MIN = 0.01;

/** Barnes-Hut 精度与速度的规模分档；小图保持默认精度。 */
export function manyBodyThetaFor(nodeCount: number): number {
  if (nodeCount >= 10_000) return 1.3;
  if (nodeCount >= 5_000) return 1.2;
  if (nodeCount >= 2_000) return 1.0;
  return 0.9;
}

export function nodeInsideViewport(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  radius: number,
): boolean {
  return (
    screenX >= -radius &&
    screenX <= canvasWidth + radius &&
    screenY >= -radius &&
    screenY <= canvasHeight + radius
  );
}

/** 容器长时间测不出尺寸时的兜底尺寸（仅用于解锁挂载，不参与常规路径） */
export const FALLBACK_SIZE = { w: 900, h: 560 };
/** 兜底触发延时：正常测量在首帧内完成，留出 300ms 给隐藏/过渡态恢复 */
export const FALLBACK_MEASURE_MS = 300;

/**
 * 首帧预热迭代数：取「不小于当前规模的实测行」的成本上界，按预算反推 tick 数。
 * 用上界行（而不是就近插值）是保守做法：规模介于两行之间时按更大的那档算成本，
 * 只会让实际耗时更低于预算。
 *
 * 结果（按 200ms 预算与上表）：500→108、1000→44、2000→19、3000→12、5000→6、
 * 8000→2（>8000 沿用 8000 档，属已知限制：未实测更大规模的每 tick 成本）。
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
