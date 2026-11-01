/**
 * 知识宇宙的逐节点向心力（Obsidian 式“中心聚拢”）。
 *
 * 为什么不能直接用 forceCenter：
 * d3 的 `forceCenter` 只把整张图的质心平移到画布中心，不会对单个节点施加
 * “回到中心”的力。星形/多连通分量的稀疏图中，叶子节点只受斥力，会被推得
 * 很远；这正是“节点很少却铺满整屏”的主要原因。
 *
 * 这里用 forceX/forceY 组合出二维向心力：
 * - x、y 分别向原点施加恢复力，强度随 alpha 衰减（与 d3 其他力一致）；
 * - 固定节点（fx/fy）自动跳过，拖拽结束后的固定位置不会被拉回；
 * - 强度按节点规模缩放：小图更明显聚拢，大图保持较低强度，避免整体塌缩。
 */

import type { ForceNode } from 'd3-force-3d';

/** 向心力强度上下限；小图靠近上限，大图靠近下限。 */
export const CENTER_GRAVITY_MIN = 0.04;
export const CENTER_GRAVITY_MAX = 0.16;

/**
 * 节点越多，单个节点越不需要强向心力：
 * - 10 个节点：0.16，明显聚拢；
 * - 100 个节点：约 0.08；
 * - 1000 个及以上：0.04，避免大图被压成一团。
 *
 * 使用平方根而不是线性衰减，保证 10–100 节点这段（个人库最常见规模）变化足够细。
 */
export function centerGravityFor(nodeCount: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 1) return CENTER_GRAVITY_MAX;
  const scaled = CENTER_GRAVITY_MAX / Math.sqrt(nodeCount / 10);
  return Math.min(CENTER_GRAVITY_MAX, Math.max(CENTER_GRAVITY_MIN, scaled));
}

/* ------------------------------------------------------------------ *
 * 星群径向软约束（graph-star-cluster-layout.md 改动 A）
 *
 * 向心力是“恒定比例”恢复力，与斥力平衡后远缘节点（尤其孤点）的平衡半径很大，
 * 轮廓会摊成椭圆或长链。这里补一层“只约束外侧”的软边界：
 * - r <= R 完全不受力，中心密集区结构不被干扰；
 * - r > R 时沿径向把节点拉向半径 R（速度式，与 d3 其他力一致，不瞬移、不抖动）；
 * - fx/fy 固定节点跳过，拖拽结果不会被拉回。
 *
 * 与 d3 `forceRadial` 的区别：forceRadial 会把所有节点拉到同一半径形成圆环，
 * 与“中心密集、边缘稀疏”的星群目标相反，故不使用。
 * ------------------------------------------------------------------ */

/** 软约束半径系数：R = K × linkDistance × √N，属轻约束，只削最远散点 */
export const RADIAL_BOUND_K = 1.6;
/** 超出部分的径向收缩强度（×alpha）；过大外圈会有粘滞感 */
export const RADIAL_BOUND_STRENGTH = 0.12;
/** 超过该规模时大图本身近似圆盘，约束收益低且会干扰压测基线，故不启用 */
export const RADIAL_BOUND_MAX_NODES = 5_000;

/** 外缘半径：非法输入按单向收敛兜底，保证返回值有限且非负 */
export function radialBoundFor(nodeCount: number, linkDistance: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 0) return 0;
  const ld = Number.isFinite(linkDistance) && linkDistance > 0 ? linkDistance : 30;
  return RADIAL_BOUND_K * ld * Math.sqrt(nodeCount);
}

export interface RadialContainForce {
  (alpha: number): void;
  initialize(nodes: ForceNode[]): void;
  radius(value: number): RadialContainForce;
  strength(value: number): RadialContainForce;
}

/**
 * 构造径向软约束力。radius/strength 任一为 0 时力自动失效（用于大图关闭该能力）。
 */
export function createRadialContainForce(radius: number, strength: number): RadialContainForce {
  let nodes: ForceNode[] = [];
  let limit = Math.max(0, Number.isFinite(radius) ? radius : 0);
  let ratio = Math.max(0, Number.isFinite(strength) ? strength : 0);

  const force = ((alpha: number) => {
    if (!(alpha > 0) || limit <= 0 || ratio <= 0) return;
    for (const node of nodes) {
      const n = node as GravityNode;
      if (n.fx != null || n.fy != null) continue;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const r = Math.hypot(x, y);
      if (!(r > limit)) continue;
      // 目标点：同方向、半径 limit；只把“超出部分”转化为速度增量
      const scale = limit / r;
      const pull = ratio * alpha;
      n.vx = (n.vx ?? 0) + (x * scale - x) * pull;
      n.vy = (n.vy ?? 0) + (y * scale - y) * pull;
    }
  }) as RadialContainForce;

  force.initialize = (next: ForceNode[]) => {
    nodes = next;
  };
  force.radius = (value: number) => {
    limit = Math.max(0, Number.isFinite(value) ? value : 0);
    return force;
  };
  force.strength = (value: number) => {
    ratio = Math.max(0, Number.isFinite(value) ? value : 0);
    return force;
  };
  return force;
}

/* ------------------------------------------------------------------ *
 * 簇锚点力（对齐 Obsidian 的多簇形态）
 *
 * 只靠全局向心力时，跨文档的 tag/wiki 边会把所有簇的枢纽拉向同一个中心，
 * 收敛成「中心枢纽 + 放射花瓣」。这里给每个节点一个所属簇的锚点：
 * 簇内围绕各自锚点收缩成团，簇间只留弱边，整体保持「多簇环绕」的圆盘。
 * ------------------------------------------------------------------ */

export interface ClusterAnchorForce {
  (alpha: number): void;
  initialize(nodes: ForceNode[]): void;
  strength(value: number): ClusterAnchorForce;
  anchors(value: Map<string, { x: number; y: number }>): ClusterAnchorForce;
}

interface AnchorNode extends GravityNode {
  id?: string;
  vx?: number;
  vy?: number;
}

export function createClusterAnchorForce(
  anchors: Map<string, { x: number; y: number }>,
  strength: number,
): ClusterAnchorForce {
  let nodes: ForceNode[] = [];
  let map = anchors;
  let ratio = Math.max(0, Number.isFinite(strength) ? strength : 0);

  const force = ((alpha: number) => {
    if (!(alpha > 0) || ratio <= 0) return;
    for (const node of nodes) {
      const n = node as AnchorNode;
      if (n.fx != null || n.fy != null) continue;
      const anchor = n.id ? map.get(n.id) : undefined;
      if (!anchor) continue;
      n.vx = (n.vx ?? 0) + (anchor.x - (n.x ?? 0)) * ratio * alpha;
      n.vy = (n.vy ?? 0) + (anchor.y - (n.y ?? 0)) * ratio * alpha;
    }
  }) as ClusterAnchorForce;

  force.initialize = (next: ForceNode[]) => {
    nodes = next;
  };
  force.strength = (value: number) => {
    ratio = Math.max(0, Number.isFinite(value) ? value : 0);
    return force;
  };
  force.anchors = (value: Map<string, { x: number; y: number }>) => {
    map = value;
    return force;
  };
  return force;
}

/** 力的最小能力面：只依赖 d3-force 的 x/y 力，便于单测替换。 */
interface AxisForce {
  (alpha: number): void;
  strength(value: number): AxisForce;
  initialize?(nodes: ForceNode[]): void;
}

interface ForceX extends AxisForce {
  x(value: number): ForceX;
}

interface ForceY extends AxisForce {
  y(value: number): ForceY;
}

interface ForceXFactory {
  (x?: number): ForceX;
}

interface ForceYFactory {
  (y?: number): ForceY;
}

interface GravityNode extends ForceNode {
  fx?: number | null;
  fy?: number | null;
}

export interface CenterGravityForce {
  (alpha: number): void;
  initialize(nodes: ForceNode[]): void;
  strength(value: number): CenterGravityForce;
  x(value: number): CenterGravityForce;
  y(value: number): CenterGravityForce;
}

/**
 * 构造二维向心力。d3 的 forceX/forceY 是分开的力，但 force-graph 只暴露
 * `d3Force(name, force)` 单槽位；这里把两者组合成一个可注册的力，避免占用
 * 两个槽位，也方便在 `d3Force('center')` 上一次性替换。
 */
export function createCenterGravityForce(
  forceX: ForceXFactory,
  forceY: ForceYFactory,
  strength: number,
): CenterGravityForce {
  const xForce = forceX(0);
  const yForce = forceY(0);
  xForce.strength(strength);
  yForce.strength(strength);
  let currentNodes: ForceNode[] = [];
  /** 可动节点缓存：拖拽期每 tick 都有力作用，避免每 tick filter 分配两个数组 */
  let movableCache: ForceNode[] | null = null;
  let lastFixedCount = 0;

  const force = ((alpha: number) => {
    if (currentNodes.length === 0) return;
    // d3 的 forceX/forceY 自身不跳过 fx/fy；固定节点会被积累速度（拖拽结束或
    // 未来启用固定布局时"抖一下"）。先用无分配扫描数出固定节点：
    // 自由布局时为 0（常态，直接走 d3 力），拖拽期恰好为 1。
    let fixedCount = 0;
    for (const node of currentNodes) {
      const n = node as GravityNode;
      if (n.fx != null || n.fy != null) fixedCount += 1;
    }
    if (fixedCount === 0) {
      if (movableCache) {
        // 从固定态回到自由态：恢复完整节点列表后再走 d3 力
        movableCache = null;
        xForce.initialize?.(currentNodes);
        yForce.initialize?.(currentNodes);
      }
      xForce(alpha);
      yForce(alpha);
      return;
    }
    // 固定节点集合规模变化时才重建 movable 缓存（拖拽开始/结束各一次）。
    // 极端情况（同一 tick 内 A 解固定、B 被固定且数量相同）缓存会滞后一轮：
    // 后果是固定节点多受一次向心速度（d3 积分器每 tick 对固定节点清零速度），无可见影响。
    if (!movableCache || fixedCount !== lastFixedCount) {
      movableCache = currentNodes.filter((node) => {
        const n = node as GravityNode;
        return n.fx == null && n.fy == null;
      });
      lastFixedCount = fixedCount;
      xForce.initialize?.(movableCache);
      yForce.initialize?.(movableCache);
    }
    xForce(alpha);
    yForce(alpha);
  }) as CenterGravityForce;

  force.initialize = (nodes: ForceNode[]) => {
    currentNodes = nodes;
    movableCache = null;
    xForce.initialize?.(nodes);
    yForce.initialize?.(nodes);
  };
  force.strength = (value: number) => {
    xForce.strength(value);
    yForce.strength(value);
    return force;
  };
  force.x = (value: number) => {
    xForce.x(value);
    return force;
  };
  force.y = (value: number) => {
    yForce.y(value);
    return force;
  };
  return force;
}
