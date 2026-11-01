/**
 * 聚合预布局（首次加载即生效）。
 *
 * 背景：首次进入图谱时 positionCache 为空，force-graph 从 d3 默认 phyllotaxis 螺旋起步，
 * 而 warmupTicks 只按 200ms 预算跑（5000 节点仅 2 tick），首帧必然散乱，要等 alpha 衰减
 * 数秒才聚合。这里先算一份确定性的「社区分簇 + 中心辐射」坐标作为初始位置，
 * 让首帧就是聚合形态，力导向只在其上微调。
 *
 * 算法（纯函数、无 DOM/随机）：
 * 1. 按链接求连通分量（同文档 doc 边 / 共同标签 tag 边 / 双链 wiki 边都算连接）；
 * 2. 分量内选度数最高的节点作中心，BFS 分层，同层节点均分到同心圆上（层内过密时自动分圈）；
 * 3. 分量之间按体量降序排布：最大分量居中，其余沿外环依次放置，互不重叠。
 *
 * 效果：相互连接的节点以弧线（绘制层 linkCurvature）围绕中心节点成簇，近似 Obsidian 图谱。
 */
import type { GraphLink, GraphNode } from './graph-types';

export interface LayoutPoint {
  x: number;
  y: number;
}

/** 簇内间距（螺旋半径步长）：与默认 linkDistance 一致，力导向接手后不会突变 */
export const CLUSTER_SPACING = 30;
/** 兼容旧命名：簇内间距 */
export const LAYER_GAP = CLUSTER_SPACING;
/** 分量之间的留白 */
const COMPONENT_GAP = 20;
/** 卫星簇装箱的螺旋步长：与簇内间距同量级，黄金角逐位搜索不重叠落点 */
const SATELLITE_SPIRAL_STEP = CLUSTER_SPACING * 1.35;
/**
 * 螺旋半径增长指数：0.5 = 均匀圆盘（P50/P95 ≈ 0.71），>0.5 产生「中心密、边缘疏」
 * 的星系密度梯度。0.75 与锚点 0.32 + 跨簇弹簧弱化组合实测小库 P50/P95 ≈ 0.53
 * （≤0.55 达标）；装箱检查保证不重叠。
 */
const SATELLITE_SPIRAL_EXP = 0.75;

const ends = (link: GraphLink): [string, string] => {
  const s = typeof link.source === 'object' ? (link.source as { id: string }).id : (link.source as unknown as string);
  const t = typeof link.target === 'object' ? (link.target as { id: string }).id : (link.target as unknown as string);
  return [s, t];
};

/** 黄金角：同层节点按低差异序列错列，避免排成正圆网格（观感接近力导向的自然散布） */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 构建仅包含给定节点的无向邻接表 */
function buildAdjacency(nodes: readonly GraphNode[], links: readonly GraphLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const link of links) {
    const [s, t] = ends(link);
    if (s === t) continue;
    if (!adj.has(s) || !adj.has(t)) continue;
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  return adj;
}

interface Component {
  ids: string[];
  center: string;
}

/** 连通分量（按 id 字典序遍历，结果确定） */
function collectComponents(nodes: readonly GraphNode[], adj: Map<string, Set<string>>): Component[] {
  const visited = new Set<string>();
  const components: Component[] = [];
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  for (const node of ordered) {
    if (visited.has(node.id)) continue;
    const ids: string[] = [];
    const queue: string[] = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      ids.push(current);
      for (const next of [...(adj.get(current) ?? [])].sort()) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    // 中心取度数最高（同度取 id 最小），保证确定性
    let center = ids[0];
    let bestDegree = -1;
    for (const id of [...ids].sort()) {
      const degree = adj.get(id)?.size ?? 0;
      if (degree > bestDegree) {
        bestDegree = degree;
        center = id;
      }
    }
    components.push({ ids, center });
  }

  return components;
}

interface ComponentLayout {
  points: Map<string, LayoutPoint>;
  radius: number;
  size: number;
}

/**
 * 分量内布局：按度数排序的黄金角螺旋圆盘。
 *
 * 为什么不用 BFS 分层同心圆：链状文档（doc 边）在分层布局里会被拉成扇形，
 * 力导向收敛后呈"扇骨"状，与 Obsidian 的团状簇不符。螺旋圆盘让每簇首帧就是
 * 一个密度均匀的团（度数高的靠内、叶子在外），力导向再自然收拢成簇。
 */
function layoutComponent(component: Component, adj: Map<string, Set<string>>): ComponentLayout {
  const ordered = [...component.ids].sort((a, b) => {
    const degreeA = adj.get(a)?.size ?? 0;
    const degreeB = adj.get(b)?.size ?? 0;
    if (degreeA !== degreeB) return degreeB - degreeA;
    return a.localeCompare(b);
  });

  const points = new Map<string, LayoutPoint>();
  let maxRadius = 0;
  ordered.forEach((id, index) => {
    // 面积均匀的螺旋：半径 ∝ √index，角度按黄金角错列，天然不重叠
    const radius = CLUSTER_SPACING * Math.sqrt(index);
    const angle = index * GOLDEN_ANGLE;
    points.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    maxRadius = Math.max(maxRadius, radius);
  });

  return { points, radius: maxRadius, size: component.ids.length };
}

/**
 * 聚合预布局：返回每个节点的初始坐标（世界坐标，原点为中心）。
 * 空图返回空 Map；不修改入参。
 */
export interface ClusterLayout {
  /** 每个节点的初始坐标 */
  positions: Map<string, LayoutPoint>;
  /** 每个节点所属簇的锚点（全局坐标）：力导向用它把簇钉在各自位置，避免全部塌向中心 */
  anchors: Map<string, LayoutPoint>;
}

/**
 * 卫星簇排布（U6 星系装箱）：主簇居中，其余簇按「向日葵螺旋」贪心装箱。
 *
 * 旧实现把卫星塞进两个固定环、用 r/sin(π/N) 反推同环间距——当卫星数远超环容量
 * （如 graph-mid 的 211 个文档簇对 9 个/环）时 sin(π/201)≈0.016 会把环半径推到
 * 数万 px，整张图炸成无法视认的长条。向日葵装箱（黄金角 + 由内向外贪心找位）
 * 与簇数量无关：半径 ∝ √Σ面积，天然紧凑（211 簇 ≈ 2.5k px，与 radialBound 同量级），
 * 且逐对检查不重叠，确定性输出。
 */
function layOut(nodes: readonly GraphNode[], links: readonly GraphLink[]): ClusterLayout {
  const positions = new Map<string, LayoutPoint>();
  const anchors = new Map<string, LayoutPoint>();
  if (!nodes || nodes.length === 0) return { positions, anchors };

  // 分簇信号优先用 doc 边（同文档相邻段）：这才是「一篇笔记一个簇」的天然边界。
  // 若 doc 边覆盖不足（例如历史压测数据只有 wiki/tag 边），退回全量边求连通分量。
  const docLinks = links.filter((link) => link.kind === 'doc');
  const docAdj = buildAdjacency(nodes, docLinks);
  const covered = nodes.filter((node) => (docAdj.get(node.id)?.size ?? 0) > 0).length;
  const useDocGroups = docLinks.length > 0 && covered >= nodes.length * 0.5;

  const adj = buildAdjacency(nodes, links);
  const groupAdj = useDocGroups ? docAdj : adj;
  const components = collectComponents(nodes, groupAdj);
  // 按包围半径选主簇（链状分量可能比节点更多的簇更"长"），半径相同再按节点数
  const layouts = components
    .map((component) => layoutComponent(component, groupAdj))
    .sort((a, b) => b.radius - a.radius || b.size - a.size);

  const placed: { x: number; y: number; r: number }[] = [];
  const fits = (cx: number, cy: number, r: number) => {
    for (const p of placed) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      // 簇间距下限：双方半径 + 留白（留白取簇内间距的一半，紧凑但可辨）
      if (dx * dx + dy * dy < (p.r + r + CLUSTER_SPACING * 0.5) ** 2) return false;
    }
    return true;
  };
  // 主簇（最大者）居中
  const [main, ...satellites] = layouts;
  if (main) {
    placed.push({ x: 0, y: 0, r: main.radius });
    for (const [id, point] of main.points) {
      positions.set(id, point);
      anchors.set(id, { x: 0, y: 0 });
    }
  }

  // 卫星按半径降序（大簇靠内），沿黄金角螺旋由内向外贪心找第一个不重叠的位置。
  // 搜索下限跳过「必然与主簇重叠」的内圈，螺旋步长与簇内间距同量级。
  satellites.forEach((layout, index) => {
    const r = layout.radius;
    const minRadius = (main?.radius ?? 0) + r + COMPONENT_GAP;
    const kMin = Math.ceil((minRadius / SATELLITE_SPIRAL_STEP) ** (1 / SATELLITE_SPIRAL_EXP));
    for (let k = kMin; k < kMin + 100_000; k += 1) {
      const radius = SATELLITE_SPIRAL_STEP * Math.pow(k, SATELLITE_SPIRAL_EXP);
      const angle = (index + k) * GOLDEN_ANGLE;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      if (fits(cx, cy, r)) {
        placed.push({ x: cx, y: cy, r });
        for (const [id, point] of layout.points) {
          positions.set(id, { x: cx + point.x, y: cy + point.y });
          anchors.set(id, { x: cx, y: cy });
        }
        return;
      }
    }
    // 理论上不可达（螺旋半径无界增长必然找到空位）；兜底放在最外圈，保证有限坐标
    const cx = Math.cos(index * GOLDEN_ANGLE) * (minRadius + r);
    const cy = Math.sin(index * GOLDEN_ANGLE) * (minRadius + r);
    placed.push({ x: cx, y: cy, r });
    for (const [id, point] of layout.points) {
      positions.set(id, { x: cx + point.x, y: cy + point.y });
      anchors.set(id, { x: cx, y: cy });
    }
  });

  return { positions, anchors };
}

/** 聚合预布局坐标（首次加载用） */
export function computeClusterLayout(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
): Map<string, LayoutPoint> {
  return layOut(nodes, links).positions;
}

/** 簇锚点（力导向用）：每个节点所属簇的中心，保证簇不被跨文档边拉向全局中心 */
export function computeClusterAnchors(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
): Map<string, LayoutPoint> {
  return layOut(nodes, links).anchors;
}
