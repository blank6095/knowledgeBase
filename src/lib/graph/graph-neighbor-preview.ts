/**
 * 详情面板关联列表折叠加载（UX-12）。
 *
 * 旧实现固定 `slice(0, 8)`，`neighborCount` 却显示全量，>8 条的关联永远不可达。
 * 这里把「默认预览前 N 条 / 展开全部」抽成纯函数：组件只负责渲染与展开状态。
 */

/** 默认预览条数（与面板视觉密度匹配）。 */
export const NEIGHBOR_PREVIEW_LIMIT = 8;

export interface NeighborPreview<T> {
  /** 当前应渲染的条目 */
  visible: T[];
  /** 被折叠、尚未渲染的条目数（展开后为 0） */
  hidden: number;
  total: number;
  /** 是否存在超出预览上限的条目（决定是否渲染「展开全部 / 收起」） */
  hasMore: boolean;
}

export function previewNeighbors<T>(
  neighbors: readonly T[],
  expanded: boolean,
  limit: number = NEIGHBOR_PREVIEW_LIMIT,
): NeighborPreview<T> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : NEIGHBOR_PREVIEW_LIMIT;
  const total = neighbors.length;
  const visibleCount = expanded ? total : Math.min(total, safeLimit);
  return {
    visible: neighbors.slice(0, visibleCount),
    hidden: total - visibleCount,
    total,
    hasMore: total > safeLimit,
  };
}
