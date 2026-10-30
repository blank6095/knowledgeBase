/**
 * 浮层定位计算（纯函数，零依赖）。
 *
 * 背景：批注/笔记类浮层此前用「固定 120px 边距」硬夹，浮层实际宽 288px，
 * 在 320/375px 窄屏上必然越界。这里把定位规则独立成可测的纯函数，
 * 组件只负责把结果写到 style 上。
 *
 * 规则：
 * - 水平：默认以锚点居中；放不下则贴最近的可用边（永不越界）；
 * - 垂直：默认在锚点下方（浮层底部对齐锚点）；下方空间不足且上方足够则翻到上方；
 * - 两者都不足时取「不越界的最大高度位置」，保证内容可见。
 */

export interface PopoverAnchor {
  /** 锚点视口坐标（px） */
  anchorX: number;
  anchorY: number;
  /** 浮层自身尺寸（px） */
  width: number;
  height: number;
  /** 视口尺寸（px） */
  viewportWidth: number;
  viewportHeight: number;
  /** 与视口边缘的最小间距（px） */
  margin?: number;
  /** 期望的垂直位置 */
  placement?: 'bottom' | 'top';
}

export interface PopoverPosition {
  /** 浮层左上角的视口坐标 */
  left: number;
  top: number;
  /** 实际采用的垂直位置（可能被翻转） */
  placement: 'bottom' | 'top';
  /** 是否因为空间不足而发生了水平贴边 */
  clampedX: boolean;
  /** 是否因为空间不足而发生了垂直翻转 */
  flipped: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 计算浮层位置。
 * 注意：返回的 top 是「浮层顶边」坐标；调用方若用 -translate-y-full 需自行改语义，
 * 这里统一返回顶边坐标，便于测试与心算。
 */
export function clampPopover({
  anchorX,
  anchorY,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = 8,
  placement = 'bottom',
}: PopoverAnchor): PopoverPosition {
  const gap = 8; // 锚点与浮层之间的视觉间距
  const usableWidth = Math.max(0, viewportWidth - margin * 2);
  const effectiveWidth = Math.min(width, usableWidth);
  const effectiveHeight = Math.min(height, Math.max(0, viewportHeight - margin * 2));

  // 水平：优先居中，越界则贴边
  const centered = anchorX - effectiveWidth / 2;
  const minLeft = margin;
  const maxLeft = Math.max(minLeft, viewportWidth - margin - effectiveWidth);
  const left = clamp(centered, minLeft, maxLeft);
  const clampedX = left !== centered;

  // 垂直：bottom 表示浮层顶边在锚点下方
  const below = anchorY + gap;
  const above = anchorY - gap - effectiveHeight;
  const spaceBelow = viewportHeight - margin - below;
  const spaceAbove = above - margin;

  let actual: 'bottom' | 'top' = placement;
  let top: number;
  if (placement === 'bottom' && spaceBelow < effectiveHeight && spaceAbove > spaceBelow) {
    actual = 'top';
    top = above;
  } else if (placement === 'bottom') {
    top = below;
  } else {
    // 期望在上方：上方不够就翻到下方
    if (spaceAbove < effectiveHeight && spaceBelow > spaceAbove) {
      actual = 'bottom';
      top = below;
    } else {
      top = above;
    }
  }

  // 仍然越界（例如浮层比视口还高）时贴到可用区域边缘
  const minTop = margin;
  const maxTop = Math.max(minTop, viewportHeight - margin - effectiveHeight);
  const clampedTop = clamp(top, minTop, maxTop);

  return {
    left,
    top: clampedTop,
    placement: actual,
    clampedX,
    flipped: actual !== placement,
  };
}

/** 浮层宽度的常用值（与批注弹层实际渲染宽度保持一致） */
export const POPOVER_WIDTH = 288; // w-72
