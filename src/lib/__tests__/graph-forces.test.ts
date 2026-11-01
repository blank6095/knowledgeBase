import { describe, expect, it } from 'vitest';
import { forceX, forceY } from 'd3-force-3d';
import {
  CENTER_GRAVITY_MAX,
  CENTER_GRAVITY_MIN,
  centerGravityFor,
  createCenterGravityForce,
} from '@/lib/graph/graph-forces';

describe('centerGravityFor：按节点规模自适应', () => {
  it('小图用较高向心力，节点越多越弱', () => {
    expect(centerGravityFor(1)).toBe(CENTER_GRAVITY_MAX);
    expect(centerGravityFor(10)).toBe(CENTER_GRAVITY_MAX);
    expect(centerGravityFor(100)).toBeLessThan(centerGravityFor(10));
    expect(centerGravityFor(1000)).toBe(CENTER_GRAVITY_MIN);
    expect(centerGravityFor(20_000)).toBe(CENTER_GRAVITY_MIN);
  });

  it('非法/空规模回退到上限，且始终落在上下限内', () => {
    for (const n of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(centerGravityFor(n)).toBeGreaterThanOrEqual(CENTER_GRAVITY_MIN);
      expect(centerGravityFor(n)).toBeLessThanOrEqual(CENTER_GRAVITY_MAX);
    }
  });
});

describe('createCenterGravityForce：组合 forceX/forceY', () => {
  it('初始化后同时向原点施加 x/y 恢复力，不改变节点数量', () => {
    const nodes = [
      { id: 'a', x: 100, y: 0, vx: 0, vy: 0 },
      { id: 'b', x: 0, y: -80, vx: 0, vy: 0 },
    ];
    const force = createCenterGravityForce(forceX, forceY, 0.1);
    force.initialize(nodes);
    force(1);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].vx).toBeLessThan(0);
    expect(nodes[0].vy).toBe(0);
    expect(nodes[1].vx).toBe(0);
    expect(nodes[1].vy).toBeGreaterThan(0);
  });

  it('strength 可更新，并同步作用于 x/y 两个分力', () => {
    const nodes = [{ id: 'a', x: 100, y: 100, vx: 0, vy: 0 }];
    const force = createCenterGravityForce(forceX, forceY, 0.1);
    force.initialize(nodes);
    force.strength(0.2);
    force(1);

    const weak = { id: 'b', x: 100, y: 100, vx: 0, vy: 0 };
    const weakForce = createCenterGravityForce(forceX, forceY, 0.05);
    weakForce.initialize([weak]);
    weakForce(1);

    expect(Math.abs(nodes[0].vx)).toBeGreaterThan(Math.abs(weak.vx));
    expect(Math.abs(nodes[0].vy)).toBeGreaterThan(Math.abs(weak.vy));
  });

  it('固定节点（fx/fy）不被向心力拉动', () => {
    const nodes = [{ id: 'a', x: 100, y: 100, vx: 0, vy: 0, fx: 100, fy: 100 }];
    const force = createCenterGravityForce(forceX, forceY, 0.2);
    force.initialize(nodes);
    force(1);

    expect(nodes[0].vx).toBe(0);
    expect(nodes[0].vy).toBe(0);
  });
});
