/**
 * 图谱首帧相关的纯函数（便于单测，不依赖 DOM / 第三方库）。
 */

/**
 * 预热预算：用「首个 tick 成本 + (n-1) × 每 tick 中位成本」估算同步开销，上限 250ms。
 * 取值一律用多次测量的最坏值（不同次运行首 tick 波动可达 2 倍，用单次好看的值会把预算判成假达标）。
 *
 * 为什么按预算而不是按收敛程度定 tick 数：force-graph 的 warmupTicks 在每次 update
 * （首挂载 / graphData 变化 / 尺寸变化）时同步跑完，大图要在同步阶段收敛需要秒级预算
 * （5000 节点 120 次 ≈3.2s、8000 节点 120 次 ≈5.3s），那本身就是长任务。
 *
 * 最坏值（4 次运行取最大，见 artifacts/tick-cost-worst.json）：
 * 节点数 ｜ 首 tick ｜ 中位 tick
 * 500    ｜  30.8ms ｜  1.59ms
 * 1000   ｜  13.6ms ｜  3.16ms
 * 2000   ｜   9.1ms ｜  7.62ms
 * 3000   ｜  12.0ms ｜ 11.56ms
 * 5000   ｜  39.8ms ｜ 31.01ms
 * 8000   ｜  92.3ms ｜ 53.81ms
 */
export const WARMUP_BUDGET_MS = 250;

/**
 * 首帧预热迭代数（每档取最坏采样下仍不超过 250ms 的整数档）：
 * - ≤600：120 次（30.8 + 119×1.59 ≈ 220ms）
 * - ≤2000：30 次（9.1 + 29×7.62 ≈ 230ms）
 * - ≤3000：20 次（12.0 + 19×11.56 ≈ 232ms）
 * - ≤6000：6 次（39.8 + 5×31.01 ≈ 195ms；6000 节点按 5000→8000 线性外推 ≈ 240ms）
 * - 更大：3 次（92.3 + 2×53.81 ≈ 200ms；8k 以上未实测，属已知限制）
 */
export function warmupTicksFor(nodeCount: number): number {
  if (nodeCount <= 0) return 0;
  if (nodeCount <= 600) return 120;
  if (nodeCount <= 2000) return 30;
  if (nodeCount <= 3000) return 20;
  if (nodeCount <= 6000) return 6;
  return 3;
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
