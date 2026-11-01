import { describe, expect, it } from 'vitest';
import {
  createRadialContainForce,
  RADIAL_BOUND_K,
  RADIAL_BOUND_MAX_NODES,
  RADIAL_BOUND_STRENGTH,
  radialBoundFor,
} from '@/lib/graph/graph-forces';

describe('radialBoundFor：星群外缘半径', () => {
  it('按 K × linkDistance × √N 计算，系数与常量一致', () => {
    expect(radialBoundFor(100, 30)).toBeCloseTo(RADIAL_BOUND_K * 30 * 10, 6);
    expect(radialBoundFor(1, 30)).toBeCloseTo(RADIAL_BOUND_K * 30, 6);
  });

  it('随节点数与连接距离单调递增（sqrt 缩放，不是线性）', () => {
    const a = radialBoundFor(100, 30);
    const b = radialBoundFor(400, 30);
    expect(b).toBeGreaterThan(a);
    // 4 倍节点 → 2 倍半径（√4）
    expect(b / a).toBeCloseTo(2, 6);
    expect(radialBoundFor(100, 60)).toBeCloseTo(a * 2, 6);
  });

  it('非法规模返回 0（等价关闭），非法连接距离回退到默认 30', () => {
    for (const n of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(radialBoundFor(n, 30)).toBe(0);
    }
    expect(radialBoundFor(100, Number.NaN)).toBeCloseTo(radialBoundFor(100, 30), 6);
    expect(radialBoundFor(100, 0)).toBeCloseTo(radialBoundFor(100, 30), 6);
  });

  it('大图关闭阈值是有限正数，用于 >5000 节点跳过约束', () => {
    expect(RADIAL_BOUND_MAX_NODES).toBeGreaterThan(0);
    expect(Number.isFinite(RADIAL_BOUND_MAX_NODES)).toBe(true);
  });
});

describe('createRadialContainForce：只约束外侧', () => {
  const makeNode = (x: number, y: number) => ({ id: `${x},${y}`, x, y, vx: 0, vy: 0 });

  it('半径内的节点完全不受力（中心密集区不被干扰）', () => {
    const nodes = [makeNode(0, 0), makeNode(30, 40), makeNode(-80, 0)];
    const force = createRadialContainForce(100, 0.2);
    force.initialize(nodes);
    force(1);

    for (const node of nodes) {
      expect(node.vx).toBe(0);
      expect(node.vy).toBe(0);
    }
  });

  it('半径外沿径向拉向原点，速度增量 = 超出量 × strength × alpha', () => {
    const nodes = [makeNode(200, 0)];
    const force = createRadialContainForce(100, 0.2);
    force.initialize(nodes);
    force(1);

    // 目标点半径 100，超出 100；增量 = (100 - 200) * 0.2 = -20
    expect(nodes[0].vx).toBeCloseTo(-20, 6);
    expect(nodes[0].vy).toBeCloseTo(0, 6);
  });

  it('alpha 衰减时收缩量等比衰减（与 d3 其他力一致，不瞬移）', () => {
    const nodes = [makeNode(0, 200)];
    const force = createRadialContainForce(100, 0.2);
    force.initialize(nodes);
    force(0.5);

    expect(nodes[0].vy).toBeCloseTo(-10, 6);
  });

  it('fx/fy 固定节点跳过（拖拽结果不会被拉回）', () => {
    const fixed = { ...makeNode(400, 0), fx: 400, fy: 0 };
    const force = createRadialContainForce(100, 0.2);
    force.initialize([fixed]);
    force(1);

    expect(fixed.vx).toBe(0);
    expect(fixed.vy).toBe(0);
  });

  it('radius/strength 任一为 0 或非法时力自动失效', () => {
    const nodes = [makeNode(400, 0)];
    for (const [radius, strength] of [
      [0, 0.2],
      [100, 0],
      [Number.NaN, 0.2],
      [100, Number.NaN],
    ] as const) {
      const node = { ...nodes[0], vx: 0, vy: 0 };
      const force = createRadialContainForce(radius, strength);
      force.initialize([node]);
      force(1);
      expect(node.vx).toBe(0);
    }
  });

  it('radius/strength 可在初始化后更新', () => {
    const node = makeNode(200, 0);
    const force = createRadialContainForce(100, 0.2);
    force.initialize([node]);
    force.radius(150).strength(0.1);
    force(1);

    // 超出 50；增量 = (150 - 200) * 0.1 = -5
    expect(node.vx).toBeCloseTo(-5, 6);
  });

  it('默认常量落在文档推荐区间', () => {
    expect(RADIAL_BOUND_STRENGTH).toBeGreaterThanOrEqual(0.05);
    expect(RADIAL_BOUND_STRENGTH).toBeLessThanOrEqual(0.2);
    expect(RADIAL_BOUND_K).toBeGreaterThanOrEqual(1.2);
    expect(RADIAL_BOUND_K).toBeLessThanOrEqual(2.5);
  });
});
