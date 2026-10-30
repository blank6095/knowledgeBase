/**
 * 图谱节点点击意图判定（U1-6 纯逻辑，便于单测）。
 *
 * 语义：同一节点在阈值内连续两次点击 → 双击（进入阅读）；否则按单击处理。
 * 容器侧用 Ref 记录上一次点击，并由 280ms 延迟保证「单击出面板」与「双击不闪面板」。
 */
export interface ClickRecord {
  id: string;
  at: number;
}

export const DOUBLE_CLICK_THRESHOLD_MS = 280;

/** 本次点击是否应视为双击（同一节点、间隔在 (0, threshold] 内）。 */
export function isDoubleClick(
  prev: ClickRecord | null | undefined,
  id: string,
  at: number,
  threshold: number = DOUBLE_CLICK_THRESHOLD_MS,
): boolean {
  if (!prev) return false;
  if (prev.id !== id) return false;
  const delta = at - prev.at;
  return delta > 0 && delta <= threshold;
}

/**
 * 计算下一次点击要保留的记录：双击后清空（避免第三次点击被误判），
 * 单击则更新为本次记录。
 */
export function nextClickRecord(
  prev: ClickRecord | null | undefined,
  id: string,
  at: number,
  threshold: number = DOUBLE_CLICK_THRESHOLD_MS,
): ClickRecord | null {
  return isDoubleClick(prev, id, at, threshold) ? null : { id, at };
}
