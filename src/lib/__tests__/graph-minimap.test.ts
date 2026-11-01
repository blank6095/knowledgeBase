import { describe, expect, it } from 'vitest';
import {
  computeBounds,
  projectToMinimap,
  unprojectFromMinimap,
  viewportRect,
} from '@/lib/graph/graph-minimap';

const nodes = [
  { x: -100, y: -50 },
  { x: 100, y: 50 },
  { x: 0, y: 0 },
];

describe('graph-minimap', () => {
  it('空/非法坐标返回 null', () => {
    expect(computeBounds([])).toBeNull();
    expect(computeBounds([{ x: Number.NaN, y: 0 }])).toBeNull();
  });

  it('边界含 8% padding，单点有最小跨度', () => {
    const bounds = computeBounds(nodes, 0.1)!;
    expect(bounds.width).toBeGreaterThan(200);
    expect(bounds.height).toBeGreaterThan(100);
    expect(bounds.minX).toBeLessThan(-100);
    expect(bounds.maxX).toBeGreaterThan(100);
    const single = computeBounds([{ x: 10, y: 10 }])!;
    expect(single.width).toBeGreaterThan(1);
    expect(single.height).toBeGreaterThan(1);
  });

  it('project/unproject 往返一致', () => {
    const bounds = computeBounds(nodes)!;
    const p = projectToMinimap(42, -12, bounds, 168, 112);
    const q = unprojectFromMinimap(p.x, p.y, bounds, 168, 112);
    expect(q.x).toBeCloseTo(42, 6);
    expect(q.y).toBeCloseTo(-12, 6);
  });

  it('投影点始终在小地图内边距内', () => {
    const bounds = computeBounds(nodes)!;
    for (const point of nodes) {
      const p = projectToMinimap(point.x, point.y, bounds, 168, 112, 4);
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.x).toBeLessThanOrEqual(164);
      expect(p.y).toBeGreaterThanOrEqual(4);
      expect(p.y).toBeLessThanOrEqual(108);
    }
  });

  it('视口矩形大小随 zoom 变化且被裁剪在画布内', () => {
    const bounds = computeBounds(nodes)!;
    const wide = viewportRect({ x: 0, y: 0 }, 0.5, { w: 1440, h: 900 }, bounds, 168, 112);
    const zoomed = viewportRect({ x: 0, y: 0 }, 4, { w: 1440, h: 900 }, bounds, 168, 112);
    expect(zoomed.width).toBeLessThanOrEqual(wide.width + 0.001);
    for (const rect of [wide, zoomed]) {
      expect(rect.x).toBeGreaterThanOrEqual(4);
      expect(rect.y).toBeGreaterThanOrEqual(4);
      expect(rect.x + rect.width).toBeLessThanOrEqual(168 - 4 + 0.001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(112 - 4 + 0.001);
    }
  });

  it('非法 zoom 回退为 1，不崩', () => {
    const bounds = computeBounds(nodes)!;
    const rect = viewportRect({ x: 0, y: 0 }, Number.NaN, { w: 1440, h: 900 }, bounds, 168, 112);
    expect(Number.isFinite(rect.width)).toBe(true);
    expect(rect.width).toBeGreaterThan(2);
  });
});
