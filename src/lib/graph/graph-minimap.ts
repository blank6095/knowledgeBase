/**
 * 小地图投影纯逻辑（U4-6）。
 *
 * 把图坐标压缩到 168×112 的缩略图（含内边距），并提供：
 * - 图坐标 → 小地图坐标（画节点点阵/视口矩形）
 * - 小地图点击 → 图坐标（点击跳转）
 * - 当前相机中心/缩放 → 小地图上的视口矩形
 *
 * 只做数学，不依赖 DOM，可单测。
 */
import type { CanvasNode } from './graph-state';

export interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export function computeBounds(nodes: readonly Pick<CanvasNode, 'x' | 'y'>[], paddingRatio = 0.08): GraphBounds | null {
  const valid = nodes.filter(
    (node): node is { x: number; y: number } => typeof node.x === 'number' && typeof node.y === 'number' && Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (valid.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of valid) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  const rawW = Math.max(1, maxX - minX);
  const rawH = Math.max(1, maxY - minY);
  // 单点/共线图给最小跨度，避免除零；再按 padding 扩展
  const width = Math.max(rawW, 1);
  const height = Math.max(rawH, 1);
  const padX = width * paddingRatio;
  const padY = height * paddingRatio;
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
    width: width + padX * 2,
    height: height + padY * 2,
  };
}

export interface MinimapPoint {
  x: number;
  y: number;
}

/** 图坐标 → 小地图 CSS 坐标（等比例，居中）。 */
export function projectToMinimap(
  x: number,
  y: number,
  bounds: GraphBounds,
  width: number,
  height: number,
  margin = 4,
): MinimapPoint {
  const innerW = Math.max(1, width - margin * 2);
  const innerH = Math.max(1, height - margin * 2);
  const scale = Math.min(innerW / bounds.width, innerH / bounds.height);
  const offsetX = margin + (innerW - bounds.width * scale) / 2;
  const offsetY = margin + (innerH - bounds.height * scale) / 2;
  return {
    x: offsetX + (x - bounds.minX) * scale,
    y: offsetY + (y - bounds.minY) * scale,
  };
}

/** 小地图 CSS 坐标 → 图坐标（project 的逆运算）。 */
export function unprojectFromMinimap(
  px: number,
  py: number,
  bounds: GraphBounds,
  width: number,
  height: number,
  margin = 4,
): MinimapPoint {
  const innerW = Math.max(1, width - margin * 2);
  const innerH = Math.max(1, height - margin * 2);
  const scale = Math.min(innerW / bounds.width, innerH / bounds.height);
  const offsetX = margin + (innerW - bounds.width * scale) / 2;
  const offsetY = margin + (innerH - bounds.height * scale) / 2;
  return {
    x: bounds.minX + (px - offsetX) / scale,
    y: bounds.minY + (py - offsetY) / scale,
  };
}

/**
 * 当前相机（中心 + zoom）对应的视口范围 → 小地图矩形。
 * 视口矩形超出小地图边界时会被裁剪，保证不画出画布。
 */
export function viewportRect(
  center: MinimapPoint,
  zoom: number,
  viewport: { w: number; h: number },
  bounds: GraphBounds,
  width: number,
  height: number,
  margin = 4,
): { x: number; y: number; width: number; height: number } {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const worldW = viewport.w / safeZoom;
  const worldH = viewport.h / safeZoom;
  const topLeft = projectToMinimap(center.x - worldW / 2, center.y - worldH / 2, bounds, width, height, margin);
  const bottomRight = projectToMinimap(center.x + worldW / 2, center.y + worldH / 2, bounds, width, height, margin);
  const left = Math.max(margin, Math.min(width - margin, topLeft.x));
  const top = Math.max(margin, Math.min(height - margin, topLeft.y));
  const right = Math.max(margin, Math.min(width - margin, bottomRight.x));
  const bottom = Math.max(margin, Math.min(height - margin, bottomRight.y));
  return { x: left, y: top, width: Math.max(2, right - left), height: Math.max(2, bottom - top) };
}
