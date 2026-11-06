/**
 * 图谱筛选空态判定（UX-28）。
 *
 * 修复前的空态只认「原始节点数为 0」，于是把记忆程度/关联类型全部取消后
 * 得到的「筛选后为空」误判为「库里还没有数据」，用户既看不到解释也找不到复位。
 *
 * 这里把两种空态显式区分开：
 * - `no-data`：原始节点数为 0 → 引导去导入（页面已有的空态）；
 * - `filtered-empty`：有数据、但当前筛选条件下可见节点为 0 → 引导重置筛选；
 * - `ready`：至少 1 个可见节点。
 *
 * 纯函数：不依赖 React/DOM，参数防御性归一（负数 / NaN / 小数），可直接单测。
 */

export type GraphFilterStatus = 'no-data' | 'filtered-empty' | 'ready';

export interface GraphFilterSummary {
  /** 原始节点数（不受筛选影响） */
  total: number;
  /** 当前筛选条件下可见节点数 */
  visible: number;
  /** 被筛选隐藏的节点数 = total - visible */
  hidden: number;
  status: GraphFilterStatus;
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * 汇总筛选结果。
 * `visible` 超过 `total` 时按 `total` 截断（可见节点不可能多于原始节点），
 * 避免脏数据导致「已隐藏 -3 个」这类荒谬文案。
 */
export function summarizeGraphFilter(total: number, visible: number): GraphFilterSummary {
  const safeTotal = normalizeCount(total);
  const safeVisible = Math.min(safeTotal, normalizeCount(visible));
  const status: GraphFilterStatus =
    safeTotal === 0 ? 'no-data' : safeVisible === 0 ? 'filtered-empty' : 'ready';
  return { total: safeTotal, visible: safeVisible, hidden: safeTotal - safeVisible, status };
}

/** 是否应显示「无匹配节点 + 重置筛选」空态（有数据但被筛没了）。 */
export function isFilteredEmpty(total: number, visible: number): boolean {
  return summarizeGraphFilter(total, visible).status === 'filtered-empty';
}

/** 空态文案里的「已隐藏 N 个」摘要。 */
export function filterEmptyHint(total: number, visible: number): string {
  const { hidden } = summarizeGraphFilter(total, visible);
  return `已隐藏 ${hidden} 个知识点`;
}
