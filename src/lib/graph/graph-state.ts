/**
 * 图谱视图状态与纯逻辑（U0-1 从 page.tsx 抽出）。
 *
 * 三层分离：
 * - 业务数据：来自 `/api/graph` 或 `/fixtures/*.json`，只读，不因主题/搜索改变；
 * - 视觉状态：记忆度档、关联类型、分组、箭头、标签阈值、尺寸、力参数、暂停；
 * - 交互状态：设置面板、搜索、悬停、双选、AI 关联解释。
 *
 * 本模块不依赖 React，纯函数可直接单测；图表尺寸/引擎实例等 DOM 相关类型放这里只为
 * 复用，不在模块加载时触碰 window。
 */
import type { NodePaint } from '@/app/graph/node-sprites';
import { colorBucketKey, shade } from '@/app/graph/color-utils';
import { MEMORY_TIER_ORDER, memoryColor, memoryTier } from '@/lib/memory';
import type { GraphLink, GraphNode } from './graph-types';

export type { GraphLink, GraphNode } from './graph-types';

/** 画布上的节点：业务节点 + force-graph 运行时字段（degree 预计算，x/y 由引擎写入）。 */
export interface CanvasNode extends GraphNode {
  degree?: number;
  x?: number;
  y?: number;
}

export interface GroupRule {
  id: number;
  query: string;
  color: string;
}

export interface Forces {
  center: number;
  charge: number;
  linkStrength: number;
  linkDistance: number;
}

/** react-force-graph-2d 实例的最小能力面（避免依赖其未导出类型）。 */
export interface FGInstance {
  pauseAnimation(): void;
  resumeAnimation(): void;
  d3Force(name: string): unknown;
  d3ReheatSimulation(): void;
  /** U2-4 视口平滑聚焦（force-graph 已提供；无参调用时为 getter） */
  centerAt(x?: number, y?: number, durationMs?: number): unknown;
  zoom(scale?: number, durationMs?: number): unknown;
  /** 图坐标 ↔ 画布像素坐标（U4-5 长按命中、验收脚本定位节点） */
  graph2ScreenCoords(x: number, y: number): { x: number; y: number };
  screen2GraphCoords(x: number, y: number): { x: number; y: number };
}

export interface ConnectSegment {
  id: string;
  title: string;
  documentTitle: string | null;
}

export interface ConnectData {
  explanation: string;
  segments: ConnectSegment[];
}

/*
 * Canvas 内绘制的色值：canvas API 无法解析 CSS 变量，与 globals.css @theme 同步维护。
 * bg = --color-canvas #0f0d0b｜label = --color-muted #a49b8c｜hoverLabel = --color-primary #ece6da
 */
export const CANVAS = {
  bg: '#0f0d0b',
  label: '#a49b8c',
  hoverLabel: '#ece6da',
} as const;

/** 深底低饱和连线色（不抢节点）：canvas 绘制用，同上同步维护 */
export const KINDS = [
  { kind: 'wiki', label: '双链', color: '#a9825a' },
  { kind: 'tag', label: '标签', color: '#5d6a77' },
  { kind: 'doc', label: '同文档', color: '#3a362f' },
] as const;

export const TABS = ['筛选', '分组', '显示', '力'] as const;
export type TabKey = (typeof TABS)[number];

export const DEFAULT_FORCES: Forces = { center: 1, charge: 60, linkStrength: 1, linkDistance: 30 };

/** 布局停止后缓存坐标；过滤重建 graphData 时作为低扰动初始值复用。 */
export const positionCache = new Map<string, { x: number; y: number }>();

/** force-graph 会把 source/target 原地替换为节点对象，取端点 id 时兼容两种形态。 */
export function ends(l: GraphLink): [string, string] {
  const s = typeof l.source === 'object' ? l.source.id : l.source;
  const t = typeof l.target === 'object' ? l.target.id : l.target;
  return [s, t];
}

/** 力参数应用到 d3 引擎并重热（graphData 变更会重建引擎，需要重新应用） */
export function applyForces(fg: FGInstance, f: Forces) {
  const center = fg.d3Force('center') as { strength?: (v: number) => void } | undefined;
  center?.strength?.(f.center);
  const charge = fg.d3Force('charge') as { strength?: (v: number) => void } | undefined;
  charge?.strength?.(-f.charge);
  const link = fg.d3Force('link') as { strength?: (v: number) => void; distance?: (v: number) => void } | undefined;
  link?.strength?.(f.linkStrength);
  link?.distance?.(f.linkDistance);
  fg.d3ReheatSimulation();
}

/** 无向邻接表（悬停高亮与标签限流使用）。 */
export function buildAdjacency(links: readonly GraphLink[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const l of links) {
    const [s, t] = ends(l);
    if (!s || !t) continue;
    add(s, t);
    add(t, s);
  }
  return m;
}

/** 搜索命中集合（null = 未搜索）。当前仅标题匹配，U2 再扩展标签/摘要。 */
export function computeMatchedIds(nodes: readonly CanvasNode[] | null, searchKw: string): Set<string> | null {
  const kw = searchKw.trim().toLowerCase();
  if (!kw || !nodes) return null;
  return new Set(nodes.filter((n) => n.title.toLowerCase().includes(kw)).map((n) => n.id));
}

/** 悬停高亮集合：自身 + 邻接。 */
export function computeHoverSet(hoverId: string | null, adjacency: Map<string, Set<string>>): Set<string> | null {
  if (!hoverId) return null;
  return new Set([hoverId, ...(adjacency.get(hoverId) ?? [])]);
}

/** 按记忆度档/关联类型过滤出可见图数据；节点附带 degree 与坐标缓存。 */
export function buildGraphData(
  nodes: readonly CanvasNode[] | null,
  links: readonly GraphLink[],
  tierOn: Record<string, boolean>,
  kindOn: Record<string, boolean>,
): { nodes: CanvasNode[]; links: GraphLink[] } {
  if (!nodes) return { nodes: [], links: [] };
  const visible = nodes.filter((n) => tierOn[memoryTier(n.memory)] ?? false);
  const visIds = new Set(visible.map((n) => n.id));
  const degree = new Map<string, number>();
  const visLinks = links.filter((l) => {
    if (!(kindOn[l.kind] ?? false)) return false;
    const [s, t] = ends(l);
    if (!visIds.has(s) || !visIds.has(t)) return false;
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
    return true;
  });
  // force-graph 会原地替换 source/target 为对象引用，传浅拷贝避免污染状态
  return {
    nodes: visible.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0, ...(positionCache.get(n.id) ?? {}) })),
    links: visLinks.map((l) => ({ ...l })),
  };
}

/**
 * 节点绘制预计算：分组关键词优先，其次记忆度（琥珀灯光梯度）。
 * shade/色桶量化只在可见节点或分组变化时重算，绘制帧内零正则解析。
 */
export function computeNodePaints(nodes: readonly CanvasNode[], groups: readonly GroupRule[]): Map<string, NodePaint> {
  const m = new Map<string, NodePaint>();
  for (const n of nodes) {
    let color = memoryColor(n.memory);
    for (const g of groups) {
      const q = g.query.trim().toLowerCase();
      if (q && n.title.toLowerCase().includes(q)) {
        color = g.color;
        break;
      }
    }
    m.set(n.id, { bucket: colorBucketKey(color), base: color, hi: shade(color, 0.18), lo: shade(color, -0.22) });
  }
  return m;
}

/** 悬停高度数枢纽（>12 邻接）时，邻接标签只显示按度排序的前 12 个，避免糊屏。 */
export function computeLabelIds(
  hoverId: string | null,
  adjacency: Map<string, Set<string>>,
  nodes: readonly CanvasNode[],
): Set<string> | null {
  if (!hoverId) return null;
  const neigh = adjacency.get(hoverId);
  if (!neigh || neigh.size <= 12) return null;
  const ranked = nodes
    .filter((n) => neigh.has(n.id))
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    .slice(0, 12);
  return new Set(ranked.map((n) => n.id));
}

const LIFTED_LINK_COLORS = new Map<string, string>(KINDS.map((k) => [k.kind, shade(k.color, 0.3)]));
const DIM_LINK_COLORS = new Map<string, string>(KINDS.map((k) => [k.kind, `${k.color}20`]));
/** 搜索命中路径（两端命中）的连线：在基础色上显著提亮，但不改变关系类型语义 */
const SEARCH_PATH_LINK_COLORS = new Map<string, string>(KINDS.map((k) => [k.kind, shade(k.color, 0.35)]));
/** U4-2 双节点最短路径的连线：比搜索命中再亮一档 */
const FOCUS_PATH_LINK_COLORS = new Map<string, string>(KINDS.map((k) => [k.kind, shade(k.color, 0.45)]));

/** 搜索视觉状态：matchedIds 为命中集合；neighborIds 非 null 表示浮层搜索激活（一阶邻居提亮） */
export interface SearchVisualState {
  matchedIds: Set<string> | null;
  neighborIds: Set<string> | null;
  /** U4-2：最短路径上的无向边 key 集合（`min|max`）；非 null 时优先于搜索/悬停状态 */
  pathEdgeKeys?: Set<string> | null;
}

/** 一阶邻居集合（排除命中节点本身），用于 U2-3 的四态绘制。 */
export function computeSearchNeighborIds(
  matchedIds: Set<string>,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const near = new Set<string>();
  for (const id of matchedIds) {
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!matchedIds.has(neighbor)) near.add(neighbor);
    }
  }
  return near;
}

/**
 * 连线颜色：
 * - 浮层搜索激活：两端命中 → 提亮（命中路径）；命中/邻居参与的边 → 基础亮度；其余 → 约 12%；
 * - 仅旧筛选命中（neighborIds 为 null）：保持阶段 1 行为（两端都命中才可见）；
 * - 无搜索：保持悬停提亮/淡出逻辑。
 */
export function computeLinkColor(
  link: GraphLink,
  search: SearchVisualState,
  hoverSet: Set<string> | null,
  hoverId: string | null,
): string {
  const kindMeta = KINDS.find((k) => k.kind === link.kind);
  const base = kindMeta?.color ?? KINDS[2].color;
  const dim = (kindMeta && DIM_LINK_COLORS.get(link.kind)) || `${base}20`;
  const [s, t] = ends(link);
  const hovered = Boolean(hoverId && (hoverId === s || hoverId === t));
  const hoverOk = !hoverSet || hoverId === s || hoverId === t;

  // U4-2 双节点路径优先：路径边高亮、其余边近乎隐没（不改变关系类型色相，只提亮/变暗）
  if (search.pathEdgeKeys) {
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (search.pathEdgeKeys.has(key)) return FOCUS_PATH_LINK_COLORS.get(link.kind) ?? base;
    return dim;
  }

  if (search.matchedIds) {
    const sHit = search.matchedIds.has(s);
    const tHit = search.matchedIds.has(t);
    if (search.neighborIds) {
      const sNear = search.neighborIds.has(s);
      const tNear = search.neighborIds.has(t);
      if (sHit && tHit) return SEARCH_PATH_LINK_COLORS.get(link.kind) ?? base;
      if (sHit || tHit || (sNear && tNear)) {
        return hovered ? (LIFTED_LINK_COLORS.get(link.kind) ?? base) : base;
      }
      return dim;
    }
    const searchOk = sHit && tHit;
    if (!searchOk || !hoverOk) return dim;
    return hovered ? (LIFTED_LINK_COLORS.get(link.kind) ?? base) : base;
  }

  if (!hoverOk) return dim;
  return hovered ? (LIFTED_LINK_COLORS.get(link.kind) ?? base) : base;
}

/**
 * 连线宽度：权重 × 用户倍率 × 悬停倍率 × 搜索命中路径加成 × 双节点路径加成（默认 1）。
 */
export function computeLinkWidth(
  link: GraphLink,
  hoverId: string | null,
  linkWidthMult: number,
  searchBoost = 1,
  pathBoost = 1,
): number {
  const [s, t] = ends(link);
  const boost = hoverId && (hoverId === s || hoverId === t) ? 1.8 : 1;
  return Math.max(0.5, link.weight * linkWidthMult * boost * searchBoost * pathBoost);
}

/** 视觉状态初值（设置面板默认值）。 */
export function createInitialVisualState() {
  return {
    tierOn: Object.fromEntries(MEMORY_TIER_ORDER.map((t) => [t, true])) as Record<string, boolean>,
    kindOn: Object.fromEntries(KINDS.map((k) => [k.kind, true])) as Record<string, boolean>,
    groups: [] as GroupRule[],
    arrows: false,
    fadeThreshold: 1.2,
    sizeMult: 1,
    linkWidthMult: 1,
    paused: false,
    forces: { ...DEFAULT_FORCES },
  };
}

/** 交互状态初值。 */
export function createInitialInteractionState() {
  return {
    panelOpen: false,
    tab: TABS[0] as TabKey,
    searchKw: '',
    hoverId: null as string | null,
    compareMode: false,
    compareIds: [] as string[],
    connectBusy: false,
    connectError: '',
    connectData: null as ConnectData | null,
  };
}

/** 业务数据初值（进入页面时未加载）。 */
export function createInitialBusinessState() {
  return {
    nodes: null as CanvasNode[] | null,
    links: [] as GraphLink[],
    fixture: null as string | null,
    error: '',
  };
}

export interface GraphBusinessState {
  nodes: CanvasNode[] | null;
  links: GraphLink[];
  fixture: string | null;
  error: string;
}

export type GraphVisualState = ReturnType<typeof createInitialVisualState>;
export type GraphInteractionState = ReturnType<typeof createInitialInteractionState>;

/** 三层状态的组合形状（容器组件按此组织 useState）。 */
export interface GraphViewState {
  business: GraphBusinessState;
  visual: GraphVisualState;
  interaction: GraphInteractionState;
}
