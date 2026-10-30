'use client';

/**
 * 图谱 Canvas 渲染层（U0-1 从 page.tsx 拆出）。
 *
 * 职责边界：只负责画布区域——容器尺寸测量、force-graph 挂载、节点/连线绘制回调、
 * 引擎 tick/stop 埋点、悬停/拖拽事件转发。不发起数据请求，不持有业务状态。
 * 视觉参数与交互集合由 `KnowledgeUniverse` 通过 props 传入。
 */
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode, RefObject } from 'react';
import { MEMORY_TIER_LABELS, memoryTier } from '@/lib/memory';
import { escapeHtml } from '@/lib/security';
import { formatDuration } from '@/lib/client';
import { drawSprite, getNodeSprite, glowBucket, radiusBucket, type NodePaint } from '@/app/graph/node-sprites';
import {
  CONVERGE_ALPHA_MIN,
  FALLBACK_MEASURE_MS,
  FALLBACK_SIZE,
  nodeInsideViewport,
  sizeChanged,
  warmupTicksFor,
} from '@/app/graph/mount-utils';
import {
  CANVAS,
  computeLinkColor,
  computeLinkWidth,
  ends,
  positionCache,
  type CanvasNode,
  type FGInstance,
  type GraphLink,
} from '@/lib/graph/graph-state';
import { pathEdgeKey } from '@/lib/graph/graph-focus';
import GraphBackground, { type GraphEnvironmentId } from './GraphBackground';

declare global {
  interface Window {
    __kbGraphFirstTick?: number;
    __kbGraphEngineStop?: number;
    /** 验收埋点：引擎停止时的节点坐标快照（与 __kbGraphFirstTick 同口径，只读） */
    __kbGraphNodePositions?: { id: string; x: number; y: number }[];
    /** 验收埋点：force-graph 实例（用于 graph2ScreenCoords 等只读验证） */
    __kbGraphInstance?: FGInstance;
  }
}

// 力导向图依赖 window，仅浏览器渲染
const Graph = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as unknown as ComponentType<{
  graphData: unknown;
  width?: number;
  height?: number;
  backgroundColor?: string;
  nodeLabel?: (n: never) => string;
  nodeCanvasObject?: (n: never, ctx: CanvasRenderingContext2D, globalScale: number) => void;
  nodePointerAreaPaint?: (n: never, color: string, ctx: CanvasRenderingContext2D) => void;
  linkColor?: (l: never) => string;
  linkWidth?: (l: never) => number;
  linkDirectionalArrowLength?: number;
  linkDirectionalArrowRelPos?: number;
  onNodeClick?: (n: never, event?: MouseEvent) => void;
  onNodeRightClick?: (n: never, event?: MouseEvent) => void;
  onBackgroundClick?: (event: MouseEvent) => void;
  onNodeHover?: (n: never, prev: never) => void;
  onNodeDrag?: (n: never) => void;
  onNodeDragEnd?: (n: never) => void;
  onEngineTick?: () => void;
  onEngineStop?: () => void;
  maxZoom?: number;
  /** 首帧前预热的迭代次数：把首帧从随机初始位置推到较合理的布局 */
  warmupTicks?: number;
  /** 布局收敛阈值：alpha 低于该值才停引擎，避免在未收敛处硬冻结 */
  d3AlphaMin?: number;
  ref?: ((instance: FGInstance | null) => void) | RefObject<FGInstance | null>;
}>;

export interface GraphCanvasProps {
  graphData: { nodes: CanvasNode[]; links: GraphLink[] };
  nodePaints: Map<string, NodePaint>;
  visual: {
    arrows: boolean;
    fadeThreshold: number;
    sizeMult: number;
    linkWidthMult: number;
  };
  interaction: {
    matchedIds: Set<string> | null;
    hoverSet: Set<string> | null;
    hoverId: string | null;
    compareIds: string[];
    labelIds: Set<string> | null;
    /** U1-5 一阶关联高亮：非集合内节点降亮度（不像搜索那样接近隐没） */
    focusIds?: Set<string> | null;
    /** U2-3 搜索一阶邻居集合（非 null 表示浮层搜索激活） */
    neighborIds?: Set<string> | null;
    /** U4-2 双节点路径高亮：路径节点集合与无向边 key 集合 */
    pathNodeIds?: Set<string> | null;
    pathEdgeKeys?: Set<string> | null;
  };
  fgRef: RefObject<FGInstance | null>;
  tooltipCache: RefObject<Map<string, string>>;
  /** 背景环境（U0-3 先支持默认深空；切换 UI 属 U3-4） */
  graphEnv?: GraphEnvironmentId;
  onNodeClick: (node: CanvasNode) => void;
  onNodeHover: (node: CanvasNode | null) => void;
  onNodeDrag: (node: CanvasNode) => void;
  onNodeDragEnd: () => void;
  /** 画布空白处单击（U1-6：取消选中并关闭详情面板） */
  onBackgroundClick?: () => void;
  /** U4-5：节点右键 / 移动端长按（视口坐标） */
  onNodeContextMenu?: (node: CanvasNode, clientX: number, clientY: number) => void;
  /** 画布内的浮层（如双选对比条），绝对定位于画布容器内 */
  children?: ReactNode;
}

export default function GraphCanvas({
  graphData,
  nodePaints,
  visual,
  interaction,
  fgRef,
  tooltipCache,
  graphEnv,
  onNodeClick,
  onNodeHover,
  onNodeDrag,
  onNodeDragEnd,
  onBackgroundClick,
  onNodeContextMenu,
  children,
}: GraphCanvasProps) {
  const { matchedIds, hoverSet, hoverId, compareIds, labelIds, focusIds, neighborIds, pathNodeIds, pathEdgeKeys } =
    interaction;
  const { arrows, fadeThreshold, sizeMult, linkWidthMult } = visual;

  const wrapRef = useRef<HTMLDivElement>(null);
  /** 容器实测尺寸：null = 尚未测量；此时不挂载 Graph，避免先用硬编码尺寸画一遍再重设 */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** 放行挂载 Graph：测量完成后再等一帧，dev 下 StrictMode 的双次挂载会在此合并 */
  const [ready, setReady] = useState(false);

  // 尺寸先行：容器挂载后先量真实尺寸，再放行 Graph——首帧即为最终尺寸，不再经历
  // “默认尺寸 → 实测尺寸”的画布重设（原双闪动之一）。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      // ±1~2px 的滚动条/亚像素抖动不触发重渲染，避免画布反复重设（见 mount-utils.sizeChanged）
      setSize((prev) => (sizeChanged(prev, { w, h }) ? { w, h } : prev));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 测量落定后再等一帧放行：把 dev StrictMode 的双次 effect 合并，引擎只初始化一次。
  useEffect(() => {
    if (ready || !size) return;
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, [ready, size]);

  // 容器被隐藏或尺寸暂为 0 时 ResizeObserver 不一定会再触发，因此补一次延时兜底：
  // 宁可先用兜底尺寸挂载（用户至少能看到图），也不把页面永久卡在“布局中”。
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => {
      setSize((prev) => prev ?? { w: FALLBACK_SIZE.w, h: FALLBACK_SIZE.h });
    }, FALLBACK_MEASURE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // 验收埋点：引擎挂载后暴露实例，供 QA 用 graph2ScreenCoords 做悬停/命中验证。
  // 用回调 ref：动态 import 的 Graph 挂载晚于父组件 effect，用 effect 取不到实例。
  const attachGraph = (instance: FGInstance | null) => {
    fgRef.current = instance;
    if (instance) window.__kbGraphInstance = instance;
  };

  // ---- U4-5 移动端长按：500ms 且位移 <10px 时命中最近节点并弹菜单 ----
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  };

  const nodeAt = (clientX: number, clientY: number): CanvasNode | null => {
    const fg = fgRef.current;
    const el = wrapRef.current;
    if (!fg || !el) return null;
    const rect = el.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    let best: CanvasNode | null = null;
    let bestDistance = 28;
    for (const node of graphData.nodes) {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
      const pt = fg.graph2ScreenCoords(node.x, node.y);
      const distance = Math.hypot(pt.x - localX, pt.y - localY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  };

  // U2-3：命中路径（两端命中）连线额外 1.8×；仅浮层搜索激活时生效
  const searchLinkBoost = (link: GraphLink) => {
    if (!matchedIds || !neighborIds) return 1;
    const [s, t] = ends(link);
    return matchedIds.has(s) && matchedIds.has(t) ? 1.8 : 1;
  };

  // U4-2：最短路径上的边额外 2.2×
  const pathLinkBoost = (link: GraphLink) => {
    if (!pathEdgeKeys) return 1;
    const [s, t] = ends(link);
    return pathEdgeKeys.has(pathEdgeKey(s, t)) ? 2.2 : 1;
  };

  const drawNode = (node: CanvasNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const inSearch = matchedIds !== null;
    const isHit = inSearch && (matchedIds?.has(node.id) ?? false);
    const isNear = inSearch && (neighborIds?.has(node.id) ?? false);
    const inHover = !hoverSet || hoverSet.has(node.id);
    const inFocus = !focusIds || focusIds.has(node.id);
    const inPath = !pathNodeIds || pathNodeIds.has(node.id);
    // 搜索四态（U2-3）：命中 1 / 一阶邻居 0.75 / 无关 0.15；再与悬停、一阶调光、路径调光相乘
    const searchAlpha = !inSearch ? 1 : isHit ? 1 : isNear ? 0.75 : 0.15;
    const alpha = searchAlpha * (inHover ? 1 : 0.15) * (inFocus ? 1 : 0.35) * (inPath ? 1 : 0.25);
    if (alpha < 0.03) return;

    const isHover = hoverId === node.id;
    const isCompared = compareIds.includes(node.id);
    const paint = nodePaints.get(node.id);
    if (!paint) return;
    const r = Math.max(2.2, (1.6 + Math.sqrt(node.degree ?? 0)) * sizeMult);
    // 悬停视觉放大 1.15×（命中半径 paintPointerArea 不变）；搜索命中再放大 1.12×
    const drawR = (isHover || isCompared ? r * 1.15 : r) * (isHit ? 1.12 : 1);
    // 灯光隐喻：光晕半径∝记忆度；悬停白热加倍；搜索命中外发光增强
    const glow =
      (2 + 10 * node.memory) * Math.min(1.5, sizeMult) * (isHover || isCompared ? 2 : 1) * (isHit ? 1.7 : 1);

    // 视口剔除：回调使用图坐标，getTransform 可得到当前画布像素坐标。
    const matrix = ctx.getTransform();
    const screenX = matrix.a * x + matrix.c * y + matrix.e;
    const screenY = matrix.b * x + matrix.d * y + matrix.f;
    const pixelRadius = (drawR + glow * 2 + 2) * Math.max(Math.abs(matrix.a), Math.abs(matrix.d));
    if (!nodeInsideViewport(screenX, screenY, ctx.canvas.width, ctx.canvas.height, pixelRadius)) return;

    // 径向渐变光球（中心亮→边缘暗）：离屏 sprite 命中则仅 drawImage
    const sprite = getNodeSprite(paint, radiusBucket(drawR), glowBucket(glow), isHover || isCompared);
    ctx.globalAlpha = alpha;
    drawSprite(ctx, sprite, x, y);

    // 标签：悬停常显；邻接固定 0.85（高度数枢纽限前 12）；其余按褪色阈值渐显
    let labelAlpha = Math.max(0, Math.min(1, (globalScale - fadeThreshold) * 1.6)) * alpha;
    if (isHover) labelAlpha = alpha;
    else if (hoverId && inHover && (!labelIds || labelIds.has(node.id))) labelAlpha = 0.85;
    if (labelAlpha > 0.02) {
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.globalAlpha = labelAlpha;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isHover ? CANVAS.hoverLabel : CANVAS.label;
      const label = node.title.length > 14 ? `${node.title.slice(0, 13)}…` : node.title;
      ctx.fillText(label, x, y + drawR + 1);
    }
    ctx.globalAlpha = 1;
  };

  const paintPointerArea = (node: CanvasNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = Math.max(4, (1.6 + Math.sqrt(node.degree ?? 0)) * sizeMult + 3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-[100dvh] w-full overflow-hidden bg-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') return;
        longPressFired.current = false;
        longPressStart.current = { x: event.clientX, y: event.clientY };
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          const start = longPressStart.current;
          if (!start) return;
          const node = nodeAt(start.x, start.y);
          if (!node) return;
          longPressFired.current = true;
          longPressStart.current = null;
          onNodeContextMenu?.(node, start.x, start.y);
        }, 500);
      }}
      onPointerMove={(event) => {
        const start = longPressStart.current;
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearLongPress();
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onClickCapture={(event) => {
        if (!longPressFired.current) return;
        longPressFired.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {/* 背景层：容器底色之上、Canvas 之下的静态纹理；Canvas 背景透明（U0-3） */}
      <GraphBackground env={graphEnv} />
      {!ready && (
        <div className="absolute inset-0" role="status" aria-label="布局中">
          <div className="skeleton absolute inset-0 rounded-none bg-transparent opacity-40" />
        </div>
      )}
      {ready && size && (
        <div className="fade-up relative z-10 h-full w-full">
          <Graph
            ref={attachGraph}
            graphData={graphData}
            width={size.w}
            height={size.h}
            warmupTicks={
              graphData.nodes.length > 0 && graphData.nodes.every((node) => positionCache.has(node.id))
                ? 0
                : warmupTicksFor(graphData.nodes.length)
            }
            d3AlphaMin={CONVERGE_ALPHA_MIN}
            // 透明画布：背景由 GraphBackground 承担（rgba 全透明，节点/连线仍正常绘制）
            backgroundColor="rgba(0,0,0,0)"
            maxZoom={4}
            nodeLabel={(n) => {
              const d = n as unknown as CanvasNode;
              const cached = tooltipCache.current.get(d.id);
              if (cached) return cached;
              const tier = MEMORY_TIER_LABELS[memoryTier(d.memory)];
              const html = `<div style="max-width:280px;padding:6px 9px;background:var(--color-elevated);color:var(--color-primary);border:1px solid var(--color-line-strong);border-radius:6px;font:13px var(--font-geist-sans),sans-serif">
                <b>${escapeHtml(d.title)}</b><br/>
                <span style="color:var(--color-faint)">${escapeHtml(d.documentTitle)}</span><br/>
                <span style="font-family:var(--font-geist-mono),monospace">${tier} · 阅读 ${d.viewCount} 次 · 累计 ${formatDuration(d.readingMs)}</span>
              </div>`;
              tooltipCache.current.set(d.id, html);
              return html;
            }}
            nodeCanvasObject={(n, ctx, gs) => drawNode(n as unknown as CanvasNode, ctx, gs)}
            nodePointerAreaPaint={(n, color, ctx) => paintPointerArea(n as unknown as CanvasNode, color, ctx)}
            linkColor={(l) =>
              computeLinkColor(
                l as unknown as GraphLink,
                { matchedIds, neighborIds: neighborIds ?? null, pathEdgeKeys: pathEdgeKeys ?? null },
                hoverSet,
                hoverId,
              )
            }
            linkWidth={(l) =>
              computeLinkWidth(
                l as unknown as GraphLink,
                hoverId,
                linkWidthMult,
                searchLinkBoost(l as unknown as GraphLink),
                pathLinkBoost(l as unknown as GraphLink),
              )
            }
            linkDirectionalArrowLength={arrows ? 3.5 : 0}
            linkDirectionalArrowRelPos={0.8}
            onNodeClick={(n) => onNodeClick(n as unknown as CanvasNode)}
            onNodeRightClick={(n, event) =>
              onNodeContextMenu?.(n as unknown as CanvasNode, event?.clientX ?? 0, event?.clientY ?? 0)
            }
            onBackgroundClick={() => onBackgroundClick?.()}
            onNodeHover={(n) => {
              const node = n ? (n as unknown as CanvasNode) : null;
              onNodeHover(node);
              document.body.style.cursor = node ? 'pointer' : 'default';
            }}
            onNodeDrag={(n) => onNodeDrag(n as unknown as CanvasNode)}
            onNodeDragEnd={onNodeDragEnd}
            onEngineTick={() => {
              if (window.__kbGraphFirstTick === undefined) window.__kbGraphFirstTick = performance.now();
            }}
            onEngineStop={() => {
              const positions: { id: string; x: number; y: number }[] = [];
              for (const node of graphData.nodes) {
                if (typeof node.x === 'number' && typeof node.y === 'number') {
                  positionCache.set(node.id, { x: node.x, y: node.y });
                  positions.push({ id: node.id, x: node.x, y: node.y });
                }
              }
              window.__kbGraphNodePositions = positions;
              window.__kbGraphEngineStop = performance.now();
              window.dispatchEvent(new Event('kb:graph-engine-stop'));
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

