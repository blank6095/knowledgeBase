'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDuration } from '@/lib/client';
import { MEMORY_TIER_META } from '@/components/MemoryBadge';
import { memoryColor, memoryTier, MEMORY_TIER_LABELS, MEMORY_TIER_ORDER } from '@/lib/memory';
import { Skeleton } from '@/components/Skeleton';
import { escapeHtml } from '@/lib/security';
import { colorBucketKey, shade } from './color-utils';
import { CONVERGE_ALPHA_MIN, FALLBACK_MEASURE_MS, FALLBACK_SIZE, sizeChanged, warmupTicksFor } from './mount-utils';
import { drawSprite, getNodeSprite, glowBucket, radiusBucket, type NodePaint } from './node-sprites';

// 力导向图依赖 window，仅浏览器渲染
const Graph = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as unknown as React.ComponentType<{
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
  onNodeClick?: (n: never) => void;
  onNodeHover?: (n: never, prev: never) => void;
  onNodeDrag?: (n: never) => void;
  onNodeDragEnd?: (n: never) => void;
  maxZoom?: number;
  /** 首帧前预热的迭代次数：把首帧从随机初始位置推到较合理的布局 */
  warmupTicks?: number;
  /** 布局收敛阈值：alpha 低于该值才停引擎，避免在未收敛处硬冻结 */
  d3AlphaMin?: number;
  ref?: React.RefObject<FGInstance | null>;
}>;

interface FGInstance {
  pauseAnimation(): void;
  resumeAnimation(): void;
  d3Force(name: string): unknown;
  d3ReheatSimulation(): void;
}

interface GNode {
  id: string;
  title: string;
  memory: number;
  viewCount: number;
  readingMs: number;
  documentTitle: string | null;
  degree?: number;
  x?: number;
  y?: number;
}
/** force-graph 会把 source/target 原地替换为节点对象 */
interface GLink {
  source: string | { id: string };
  target: string | { id: string };
  kind: string;
  weight: number;
}

interface GroupRule {
  id: number;
  query: string;
  color: string;
}
interface Forces {
  center: number;
  charge: number;
  linkStrength: number;
  linkDistance: number;
}

/*
 * Canvas 内绘制的色值：canvas API 无法解析 CSS 变量，与 globals.css @theme 同步维护。
 * bg = --color-canvas #0f0d0b｜label = --color-muted #a49b8c｜hoverLabel = --color-primary #ece6da
 */
const CANVAS = {
  bg: '#0f0d0b',
  label: '#a49b8c',
  hoverLabel: '#ece6da',
};
/** 深底低饱和连线色（不抢节点）：canvas 绘制用，同上同步维护 */
const KINDS = [
  { kind: 'wiki', label: '双链', color: '#a9825a' },
  { kind: 'tag', label: '标签', color: '#5d6a77' },
  { kind: 'doc', label: '同文档', color: '#3a362f' },
];
const TABS = ['筛选', '分组', '显示', '力'] as const;

function ends(l: GLink): [string, string] {
  const s = typeof l.source === 'object' ? l.source.id : l.source;
  const t = typeof l.target === 'object' ? l.target.id : l.target;
  return [s, t];
}

/** 力参数应用到 d3 引擎并重热（graphData 变更会重建引擎，需要重新应用） */
function applyForces(fg: FGInstance, f: Forces) {
  const center = fg.d3Force('center') as { strength?: (v: number) => void } | undefined;
  center?.strength?.(f.center);
  const charge = fg.d3Force('charge') as { strength?: (v: number) => void } | undefined;
  charge?.strength?.(-f.charge);
  const link = fg.d3Force('link') as { strength?: (v: number) => void; distance?: (v: number) => void } | undefined;
  link?.strength?.(f.linkStrength);
  link?.distance?.(f.linkDistance);
  fg.d3ReheatSimulation();
}

export default function GraphPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<GNode[] | null>(null);
  const [links, setLinks] = useState<GLink[]>([]);
  const [error, setError] = useState('');
  // 压测模式：?fixture=<name> 加载 /fixtures/<name>.json（由 scripts/gen-graph-data.mjs 生成）。
  // 在 effect 里读取 URL，避免渲染期依赖 window 造成 SSR/客户端水合不匹配。
  const [fixture, setFixture] = useState<string | null>(null);

  // 设置面板
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('筛选');
  const [searchKw, setSearchKw] = useState('');
  const [tierOn, setTierOn] = useState<Record<string, boolean>>(
    Object.fromEntries(MEMORY_TIER_ORDER.map((t) => [t, true])),
  );
  const [kindOn, setKindOn] = useState<Record<string, boolean>>(
    Object.fromEntries(KINDS.map((k) => [k.kind, true])),
  );
  const [groups, setGroups] = useState<GroupRule[]>([]);
  const [newGroupQuery, setNewGroupQuery] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#e8b04b');
  const [arrows, setArrows] = useState(false);
  const [fadeThreshold, setFadeThreshold] = useState(1.2);
  const [sizeMult, setSizeMult] = useState(1);
  const [linkWidthMult, setLinkWidthMult] = useState(1);
  const [paused, setPaused] = useState(false);
  const [forces, setForces] = useState<Forces>({ center: 1, charge: 60, linkStrength: 1, linkDistance: 30 });

  const [hoverId, setHoverId] = useState<string | null>(null);
  const fgRef = useRef<FGInstance | null>(null);
  const forcesTouched = useRef(false);
  const groupId = useRef(0);
  /** 记录本次拖拽是否已重热，避免每个 pointermove 都把布局重置为满能量 */
  const draggingNodeId = useRef<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  /** 容器实测尺寸：null = 尚未测量；此时不挂载 Graph，避免先用硬编码尺寸画一遍再重设 */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** 放行挂载 Graph：测量完成后再等一帧，dev 下 StrictMode 的双次挂载会在此合并 */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('fixture');
    api<{ nodes: GNode[]; edges: GLink[] }>(f ? `/fixtures/${f}.json` : '/api/graph')
      .then((d) => {
        setFixture(f);
        setNodes(d.nodes);
        setLinks(d.edges);
      })
      .catch((e) => setError(e.message));
  }, []);

  // 尺寸先行：容器挂载后先量真实尺寸，再放行 Graph——首帧即为最终尺寸，不再经历
  // “默认尺寸 → 实测尺寸”的画布重设（原双闪动之一）。
  useEffect(() => {
    if (!nodes || nodes.length === 0) return;
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
  }, [nodes]);

  // 测量落定后再等一帧放行：把 dev StrictMode 的双次 effect 合并，引擎只初始化一次。
  // 容器被隐藏或尺寸暂为 0 时 ResizeObserver 不一定会再触发，因此补一次延时兜底：
  // 宁可先用兜底尺寸挂载（用户至少能看到图），也不把页面永久卡在“布局中”。
  useEffect(() => {
    if (ready || !size) return;
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, [ready, size]);

  useEffect(() => {
    if (ready || !nodes || nodes.length === 0) return;
    const timer = setTimeout(() => {
      setSize((prev) => prev ?? { w: FALLBACK_SIZE.w, h: FALLBACK_SIZE.h });
    }, FALLBACK_MEASURE_MS);
    return () => clearTimeout(timer);
  }, [ready, nodes]);

  // 引擎随 graphData 变更重建后，恢复用户已调整的力参数与暂停态
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (forcesTouched.current) applyForces(fg, forces);
    if (paused) fg.pauseAnimation();
  }, [nodes, links, forces, paused]);

  const adjacency = useMemo(() => {
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
  }, [links]);

  // 搜索命中集合（null = 未搜索）
  const matchedIds = useMemo(() => {
    const kw = searchKw.trim().toLowerCase();
    if (!kw || !nodes) return null;
    return new Set(nodes.filter((n) => n.title.toLowerCase().includes(kw)).map((n) => n.id));
  }, [nodes, searchKw]);

  // 悬停高亮集合：自身 + 邻接
  const hoverSet = useMemo(() => {
    if (!hoverId) return null;
    return new Set([hoverId, ...(adjacency.get(hoverId) ?? [])]);
  }, [hoverId, adjacency]);

  const graphData = useMemo(() => {
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
      nodes: visible.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
      links: visLinks.map((l) => ({ ...l })),
    };
  }, [nodes, links, tierOn, kindOn]);

  // 节点绘制预计算：分组关键词优先，其次记忆度（琥珀灯光梯度）。
  // shade/色桶量化只在可见节点或分组变化时重算，绘制帧内零正则解析。
  const nodePaints = useMemo(() => {
    const m = new Map<string, NodePaint>();
    for (const n of graphData.nodes) {
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
  }, [graphData.nodes, groups]);

  // 悬停高度数枢纽（>12 邻接）时，邻接标签只显示按度排序的前 12 个，避免糊屏
  const labelIds = useMemo(() => {
    if (!hoverId) return null;
    const neigh = adjacency.get(hoverId);
    if (!neigh || neigh.size <= 12) return null;
    const ranked = graphData.nodes
      .filter((n) => neigh.has(n.id))
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .slice(0, 12);
    return new Set(ranked.map((n) => n.id));
  }, [hoverId, adjacency, graphData.nodes]);

  // 接触悬停节点的连线提亮 / 非接触淡化（按类型预计算，避免逐边逐帧解析与拼串）
  const liftedLinks = useMemo(() => new Map(KINDS.map((k) => [k.kind, shade(k.color, 0.3)])), []);
  const dimLinks = useMemo(() => new Map(KINDS.map((k) => [k.kind, `${k.color}20`])), []);

  if (error) return <p className="text-body text-danger">{error}</p>;

  const onForce = (patch: Partial<Forces>) => {
    const next = { ...forces, ...patch };
    forcesTouched.current = true;
    setForces(next);
    if (fgRef.current) applyForces(fgRef.current, next);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    const fg = fgRef.current;
    if (!fg) return;
    if (next) fg.pauseAnimation();
    else fg.resumeAnimation();
  };

  const onNodeDrag = (node: GNode) => {
    if (draggingNodeId.current === node.id) return;
    draggingNodeId.current = node.id;

    const fg = fgRef.current;
    if (!fg) return;

    // force-graph 会先按旧 alpha 判定收敛并停引擎，再应用拖拽时的 alphaTarget。
    // 已收敛的图若不显式重热，当前节点由指针直接移动，邻接节点却不会参与仿真。
    fg.d3ReheatSimulation();
    if (paused) fg.resumeAnimation();
  };

  const onNodeDragEnd = () => {
    draggingNodeId.current = null;
    if (paused) fgRef.current?.pauseAnimation();
  };

  const addGroup = () => {
    const q = newGroupQuery.trim();
    if (!q) return;
    groupId.current += 1;
    setGroups((gs) => [...gs, { id: groupId.current, query: q, color: newGroupColor }]);
    setNewGroupQuery('');
  };

  const drawNode = (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const inSearch = !matchedIds || matchedIds.has(node.id);
    const inHover = !hoverSet || hoverSet.has(node.id);
    const alpha = (inSearch ? 1 : 0.15) * (inHover ? 1 : 0.15);

    const isHover = hoverId === node.id;
    const paint = nodePaints.get(node.id);
    if (!paint) return;
    const r = Math.max(2.2, (1.6 + Math.sqrt(node.degree ?? 0)) * sizeMult);
    // 悬停视觉放大 1.15×（命中半径 paintPointerArea 不变）
    const drawR = isHover ? r * 1.15 : r;
    // 灯光隐喻：光晕半径∝记忆度；悬停白热加倍
    const glow = (2 + 10 * node.memory) * Math.min(1.5, sizeMult) * (isHover ? 2 : 1);

    // 径向渐变光球（中心亮→边缘暗）：离屏 sprite 命中则仅 drawImage
    const sprite = getNodeSprite(paint, radiusBucket(drawR), glowBucket(glow), isHover);
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

  const paintPointerArea = (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = Math.max(4, (1.6 + Math.sqrt(node.degree ?? 0)) * sizeMult + 3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  };

  const linkColorOf = (l: GLink) => {
    const kindMeta = KINDS.find((k) => k.kind === l.kind);
    const base = kindMeta?.color ?? KINDS[2].color;
    const [s, t] = ends(l);
    const searchOk = !matchedIds || (matchedIds.has(s) && matchedIds.has(t));
    const hoverOk = !hoverSet || hoverId === s || hoverId === t;
    // 非接触（含搜索未命中叠加）：近乎隐没（约 12%）；接触悬停线提亮 30% 并保留 1.8× 粗
    if (!searchOk || !hoverOk) return (kindMeta && dimLinks.get(l.kind)) || `${base}20`;
    if (hoverId && (hoverId === s || hoverId === t)) return liftedLinks.get(l.kind) ?? base;
    return base;
  };
  const linkWidthOf = (l: GLink) => {
    const [s, t] = ends(l);
    const boost = hoverId && (hoverId === s || hoverId === t) ? 1.8 : 1;
    return Math.max(0.5, l.weight * linkWidthMult * boost);
  };

  const header = (
    <div className="relative flex flex-wrap items-center gap-3">
      <h1 className="font-display text-title font-semibold">关系图谱</h1>
      {fixture && nodes && (
        <span className="rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-tag font-medium text-warn">
          压测数据模式：{fixture}（{nodes.length} 节点）
        </span>
      )}
      <div className="flex-1" />
      {/* 记忆度图例：熄灭的灰 → 琥珀灯光 */}
      <div className="hidden items-center gap-3 text-tag text-muted sm:flex">
        <span className="text-faint">记忆度</span>
        <span className="flex items-center gap-1">
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: MEMORY_TIER_META.unread.dot }} />
          未读
        </span>
        <span
          className="h-2.5 w-16 rounded-full"
          style={{ background: `linear-gradient(to right, ${memoryColor(0.05)}, ${memoryColor(0.5)}, ${memoryColor(1)})` }}
        />
        <span className="flex items-center gap-1">
          {MEMORY_TIER_LABELS.strong}
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: memoryColor(1) }} />
        </span>      </div>
      <button
        onClick={() => setPanelOpen((o) => !o)}
        aria-label="关系图谱设置"
        className={`rounded-lg border px-2.5 py-1.5 text-body transition-colors duration-150 ${
          panelOpen
            ? 'border-accent bg-accent text-accent-ink'
            : 'border-line bg-surface text-muted hover:bg-surface-hover hover:text-primary'
        }`}
      >
        ⚙
      </button>

      {panelOpen && (
        <div className="absolute right-0 top-11 z-30 w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-elevated p-3 text-tag shadow-2xl">
          <div className="mb-3 flex gap-0.5 border-b border-line pb-2">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md px-2 py-1.5 transition-colors duration-150 ${
                  tab === t ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-hover hover:text-primary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === '筛选' && (
            <div className="space-y-3">
              <input
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                placeholder="搜索标题：命中高亮，其余淡化"
                className="w-full rounded-lg border border-line bg-app px-2.5 py-1.5 text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
              />
              <div>
                <p className="mb-1.5 text-faint">记忆程度</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {MEMORY_TIER_ORDER.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={tierOn[t] ?? false}
                        onChange={(e) => setTierOn((prev) => ({ ...prev, [t]: e.target.checked }))}
                      />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: MEMORY_TIER_META[t].dot }} />
                      {MEMORY_TIER_META[t].label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-faint">关联类型</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {KINDS.map((k) => (
                    <label key={k.kind} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={kindOn[k.kind] ?? false}
                        onChange={(e) => setKindOn((prev) => ({ ...prev, [k.kind]: e.target.checked }))}
                      />
                      <span className="h-0.5 w-4 rounded" style={{ background: k.color }} />
                      {k.label}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-tag leading-relaxed text-faint">节点大小 = 关联数 · 悬停高亮邻接 · 点击进入知识点 · 节点可拖拽</p>
            </div>
          )}

          {tab === '分组' && (
            <div className="space-y-2">
              <p className="text-muted">默认：按记忆程度着色（琥珀灯光，越亮记得越牢，灰=未读）。命中关键词分组的节点改用该组颜色（优先于记忆度）。</p>
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={g.color}
                    onChange={(e) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, color: e.target.value } : x)))}
                    className="h-6 w-8 cursor-pointer rounded border border-line bg-app"
                    aria-label="分组颜色"
                  />
                  <input
                    value={g.query}
                    onChange={(e) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, query: e.target.value } : x)))}
                    className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-minor text-primary outline-none transition-colors focus:border-accent"
                  />
                  <button
                    onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                    className="rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-danger"
                    aria-label="删除分组"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 border-t border-line pt-2">
                <input
                  type="color"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border border-line bg-app"
                  aria-label="新分组颜色"
                />
                <input
                  value={newGroupQuery}
                  onChange={(e) => setNewGroupQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                  placeholder="关键词…"
                  className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-minor text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
                />
                <button
                  onClick={addGroup}
                  className="rounded bg-accent px-2.5 py-1 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
                >
                  添加
                </button>
              </div>
            </div>
          )}

          {tab === '显示' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="accent-accent" checked={arrows} onChange={(e) => setArrows(e.target.checked)} />
                  连线方向箭头
                </label>
                <button
                  onClick={togglePause}
                  className={`rounded-md border px-2 py-1 transition-colors duration-150 ${
                    paused ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line text-muted hover:bg-surface-hover hover:text-primary'
                  }`}
                >
                  {paused ? '▶ 继续动画' : '⏸ 暂停动画'}
                </button>
              </div>
              <LabeledSlider label="文本褪色阈值" value={fadeThreshold} min={0.5} max={3} step={0.1} onChange={setFadeThreshold} hint="缩放小于该值时标签淡出" />
              <LabeledSlider label="节点大小" value={sizeMult} min={0.5} max={3} step={0.1} onChange={setSizeMult} />
              <LabeledSlider label="连线粗细" value={linkWidthMult} min={0.5} max={4} step={0.1} onChange={setLinkWidthMult} />
            </div>
          )}

          {tab === '力' && (
            <div className="space-y-3">
              <LabeledSlider label="中心力" value={forces.center} min={0} max={2} step={0.05} onChange={(v) => onForce({ center: v })} />
              <LabeledSlider label="斥力" value={forces.charge} min={10} max={300} step={5} onChange={(v) => onForce({ charge: v })} hint="越大节点间排斥越强" />
              <LabeledSlider label="连接力" value={forces.linkStrength} min={0.1} max={1} step={0.05} onChange={(v) => onForce({ linkStrength: v })} />
              <LabeledSlider label="连接距离" value={forces.linkDistance} min={10} max={200} step={5} onChange={(v) => onForce({ linkDistance: v })} />
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {header}

      {nodes === null ? (
        <div className="relative h-[calc(100vh-11rem)] min-h-[420px] overflow-hidden rounded-xl border border-line bg-canvas" role="status" aria-label="加载中">
          <div className="skeleton absolute inset-0 rounded-none bg-transparent opacity-60" />
          <div className="absolute left-4 top-4 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ) : nodes.length === 0 ? (
        <div className="card fade-up px-6 py-14 text-center">
          <p className="font-display text-subtitle text-primary">图谱还没有灯。</p>
          <p className="mt-2 text-minor text-muted">导入一篇笔记，知识点会自动连成网络，读过的会亮起来。</p>
          <Link
            href="/import"
            className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
          >
            去导入
          </Link>
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative h-[calc(100vh-11rem)] min-h-[420px] overflow-hidden rounded-xl border border-line bg-canvas"
        >
          {!ready && (
            <div className="absolute inset-0" role="status" aria-label="布局中">
              <div className="skeleton absolute inset-0 rounded-none bg-transparent opacity-40" />
            </div>
          )}
          {ready && size && (
            <div className="fade-up h-full w-full">
              <Graph
                ref={fgRef}
                graphData={graphData}
                width={size.w}
                height={size.h}
                warmupTicks={warmupTicksFor(graphData.nodes.length)}
                d3AlphaMin={CONVERGE_ALPHA_MIN}
                backgroundColor={CANVAS.bg}
                maxZoom={4}
                nodeLabel={(n) => {
                  const d = n as unknown as GNode;
                  const tier = MEMORY_TIER_LABELS[memoryTier(d.memory)];
                  return `<div style="max-width:280px;padding:6px 9px;background:var(--color-elevated);color:var(--color-primary);border:1px solid var(--color-line-strong);border-radius:6px;font:13px var(--font-geist-sans),sans-serif">
                <b>${escapeHtml(d.title)}</b><br/>
                <span style="color:var(--color-faint)">${escapeHtml(d.documentTitle)}</span><br/>
                <span style="font-family:var(--font-geist-mono),monospace">${tier} · 阅读 ${d.viewCount} 次 · 累计 ${formatDuration(d.readingMs)}</span>
              </div>`;
                }}
                nodeCanvasObject={(n, ctx, gs) => drawNode(n as unknown as GNode, ctx, gs)}
                nodePointerAreaPaint={(n, color, ctx) => paintPointerArea(n as unknown as GNode, color, ctx)}
                linkColor={(l) => linkColorOf(l as unknown as GLink)}
                linkWidth={(l) => linkWidthOf(l as unknown as GLink)}
                linkDirectionalArrowLength={arrows ? 3.5 : 0}
                linkDirectionalArrowRelPos={0.8}
                onNodeClick={(n) => router.push(`/segments/${(n as unknown as GNode).id}`)}
                onNodeHover={(n) => {
                  const id = n ? (n as unknown as GNode).id : null;
                  setHoverId(id);
                  document.body.style.cursor = id ? 'pointer' : 'default';
                }}
                onNodeDrag={(n) => onNodeDrag(n as unknown as GNode)}
                onNodeDragEnd={onNodeDragEnd}
              />
            </div>
          )}
          <span className="pointer-events-none absolute bottom-2 left-3 text-tag text-faint">
            节点大小 = 关联数 · 点击节点查看知识点
          </span>
        </div>
      )}
    </div>
  );
}

function LabeledSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-faint">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      {hint && <span className="block text-tag text-faint">{hint}</span>}
    </label>
  );
}
