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
 * 取值必须落在 (0, 1)：0 退化为「永不按 alpha 停」，1 会立即停。
 */
export const CONVERGE_ALPHA_MIN = 0.01;

/**
 * 布局引擎预算（FE-002）：alpha 衰减速率 + 冷却兜底。
 *
 * 实测（artifacts/graph-baseline.json）：大图默认参数下 alpha 从未自然降到
 * CONVERGE_ALPHA_MIN——默认 d3AlphaDecay 0.0228 约需 200 个 tick 才收敛，
 * 而布局期帧率只有 2-6fps，force-graph 的 cooldownTime=15000 兜底先触发，
 * 16s 停止的是「时间兜底」而非「收敛自停」。
 *
 * 策略（修正早前「一律不用 cooldownTicks 硬停」的结论）：
 * - 大图提高 d3AlphaDecay（tick 数按 4.6/decay 缩短），让 alpha 在更少帧内
 *   自然衰减到 CONVERGE_ALPHA_MIN——收敛路径不变，只是走得更快；
 * - cooldownTicks/cooldownTime 只作兜底（时间上限 7s：实测 8s 兜底叠加帧边界
 *   与引擎启动开销后实际停止 ≈8.15s，恰好越过验收线，故留 ~1s 余量），
 *   不再依赖默认 15000。
 * 小图保持默认：500 节点约 0.6s 即自然收敛，动参数没有收益。
 */
export interface LayoutBudget {
  d3AlphaDecay: number;
  cooldownTicks: number;
  cooldownTime: number;
}

export function layoutBudgetFor(nodeCount: number): LayoutBudget {
  if (nodeCount < 1_000) return { d3AlphaDecay: 0.0228, cooldownTicks: Infinity, cooldownTime: 15_000 };
  if (nodeCount < 5_000) return { d3AlphaDecay: 0.05, cooldownTicks: 250, cooldownTime: 7_000 };
  return { d3AlphaDecay: 0.08, cooldownTicks: 250, cooldownTime: 7_000 };
}

/**
 * 渲染分级预算（FE-002）：布局期每帧全量绘制是大图掉帧主因
 * （5k 节点实测 p95 480ms/帧，其中模拟 tick 仅 ~31ms），按节点数分级削减
 * 标签数量、光晕强度与边箭头，收回绘制预算而不改变布局质量。
 */
export interface RenderBudget {
  /** 单帧标签占位上限（替代写死的 MAX_LABELS） */
  maxLabels: number;
  /** 光晕强度倍率：shadowBlur 是逐节点最贵的状态切换 */
  glowScale: number;
  /** 边箭头逐边独立 beginPath/fill，大图直接关闭 */
  arrowsOn: boolean;
}

export function renderBudgetFor(nodeCount: number): RenderBudget {
  if (nodeCount < 2_000) return { maxLabels: 90, glowScale: 1, arrowsOn: true };
  if (nodeCount < 5_000) return { maxLabels: 60, glowScale: 0.7, arrowsOn: false };
  return { maxLabels: 30, glowScale: 0.5, arrowsOn: false };
}

/**
 * 可见边绘制预算（FE-002）：可见边超过该值时对 doc（同文档相邻）边按步长抽稀。
 *
 * linkVisibility 只影响 force-graph 的绘制（paintLinks/paintArrows/paintPhotons
 * 各自 filter 一次全量边），力模拟仍读完整 links 数组——抽稀不会劣化布局质量。
 * wiki/tag 结构边全保留；doc 边数量最多、单条信息密度最低，优先抽稀。
 * 返回 null 表示无需抽稀（调用方不传 linkVisibility，保持默认全可见）。
 */
export const LINK_VISIBLE_BUDGET = 10_000;

export function selectHiddenLinks<L extends { kind: string }>(
  links: readonly L[],
  budget = LINK_VISIBLE_BUDGET,
): Set<L> | null {
  if (links.length <= budget) return null;
  const structural: L[] = [];
  const doc: L[] = [];
  for (const l of links) {
    if (l.kind === 'wiki' || l.kind === 'tag') structural.push(l);
    else doc.push(l);
  }
  const docQuota = Math.max(0, budget - structural.length);
  const hidden = new Set<L>();
  if (docQuota === 0) {
    for (const l of doc) hidden.add(l);
    return hidden.size > 0 ? hidden : null;
  }
  const step = Math.max(1, Math.ceil(doc.length / docQuota));
  if (step <= 1) return null;
  for (let i = 0; i < doc.length; i += 1) {
    if (i % step !== 0) hidden.add(doc[i]);
  }
  return hidden.size > 0 ? hidden : null;
}

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
