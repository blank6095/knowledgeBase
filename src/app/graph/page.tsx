'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDuration } from '@/lib/client';
import { MEMORY_TIER_META } from '@/components/MemoryBadge';
import { memoryColor, memoryTier, MEMORY_TIER_ORDER } from '@/lib/memory';

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

/** 深底可辨的连线色 */
const KINDS = [
  { kind: 'wiki', label: '双链', color: '#9d8cff' },
  { kind: 'tag', label: '标签', color: '#8b9bb4' },
  { kind: 'doc', label: '同文档', color: '#4a4a4a' },
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
  // 压测模式：?fixture=<name> 加载 /fixtures/<name>.json（由 scripts/gen-graph-data.mjs 生成）
  const [fixture] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fixture') : null,
  );

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
  const [newGroupColor, setNewGroupColor] = useState('#8b6cef');
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

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  useEffect(() => {
    api<{ nodes: GNode[]; edges: GLink[] }>(fixture ? `/fixtures/${fixture}.json` : '/api/graph')
      .then((d) => {
        setNodes(d.nodes);
        setLinks(d.edges);
      })
      .catch((e) => setError(e.message));
  }, [fixture]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes]);

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

  if (error) return <p className="text-danger">{error}</p>;
  if (!nodes) return <p className="text-muted">加载中…</p>;

  /** 节点着色：自定义关键词分组优先，其次按记忆度（紫色系亮度渐变） */
  const resolveColor = (n: GNode) => {
    for (const g of groups) {
      const q = g.query.trim().toLowerCase();
      if (q && n.title.toLowerCase().includes(q)) return g.color;
    }
    return memoryColor(n.memory);
  };

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

    const r = Math.max(2.2, (1.6 + Math.sqrt(node.degree ?? 0)) * sizeMult);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = resolveColor(node);
    ctx.fill();
    if (hoverId === node.id) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#e0e0e0';
      ctx.stroke();
    }

    // 节点标签：缩放超过褪色阈值后渐显
    const labelAlpha = Math.max(0, Math.min(1, (globalScale - fadeThreshold) * 1.6)) * alpha;
    if (labelAlpha > 0.02) {
      const fontSize = Math.max(10 / globalScale, 3);
      ctx.globalAlpha = labelAlpha;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#a3a3a3';
      const label = node.title.length > 14 ? `${node.title.slice(0, 13)}…` : node.title;
      ctx.fillText(label, x, y + r + 1);
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
    const base = KINDS.find((k) => k.kind === l.kind)?.color ?? '#5a5a5a';
    const [s, t] = ends(l);
    const searchOk = !matchedIds || (matchedIds.has(s) && matchedIds.has(t));
    const hoverOk = !hoverSet || hoverId === s || hoverId === t;
    return searchOk && hoverOk ? base : `${base}40`;
  };
  const linkWidthOf = (l: GLink) => {
    const [s, t] = ends(l);
    const boost = hoverId && (hoverId === s || hoverId === t) ? 1.8 : 1;
    return Math.max(0.5, l.weight * linkWidthMult * boost);
  };

  return (
    <div className="space-y-3">
      <div className="relative flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">关系图谱</h1>
        {fixture && (
          <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-medium text-warn">
            压测数据模式：{fixture}（{nodes.length} 节点）
          </span>
        )}
        <div className="flex-1" />
        {/* 记忆度图例 */}
        <div className="hidden items-center gap-3 text-xs text-muted sm:flex">
          <span className="text-muted/60">记忆度</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[#4b5563]" />未读</span>
          <span
            className="h-2.5 w-16 rounded-full"
            style={{ background: `linear-gradient(to right, ${memoryColor(0.05)}, ${memoryColor(0.5)}, ${memoryColor(1)})` }}
          />
          <span className="flex items-center gap-1">强<i className="h-2.5 w-2.5 rounded-full" style={{ background: memoryColor(1) }} /></span>
        </div>
        <button
          onClick={() => setPanelOpen((o) => !o)}
          aria-label="关系图谱设置"
          className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
            panelOpen ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-muted hover:bg-surface-hover hover:text-primary'
          }`}
        >
          ⚙
        </button>

        {panelOpen && (
          <div className="absolute right-0 top-11 z-30 w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3 text-xs shadow-2xl">
            <div className="mb-3 flex gap-0.5 border-b border-line pb-2">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                    tab === t ? 'bg-accent text-white' : 'text-muted hover:bg-surface-hover hover:text-primary'
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
                  className="w-full rounded-lg border border-line bg-app px-2.5 py-1.5 text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                />
                <div>
                  <p className="mb-1.5 text-muted/60">记忆程度</p>
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
                  <p className="mb-1.5 text-muted/60">关联类型</p>
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
                <p className="text-[11px] leading-relaxed text-muted/70">节点大小 = 关联数 · 悬停高亮邻接 · 点击进入知识点 · 节点可拖拽</p>
              </div>
            )}

            {tab === '分组' && (
              <div className="space-y-2">
                <p className="text-muted">默认：按记忆程度着色（紫色系，越亮记得越牢，灰=未读）。命中关键词分组的节点改用该组颜色（优先于记忆度）。</p>
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
                      className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-primary outline-none transition-colors focus:border-accent"
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
                    className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
                  />
                  <button onClick={addGroup} className="rounded bg-accent px-2.5 py-1 text-white transition-colors hover:bg-accent/85">
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
                    className={`rounded-md border px-2 py-1 transition-colors ${
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

      {nodes.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-muted">
          还没有知识点，先去 <Link href="/import" className="text-accent underline">导入</Link> 一篇笔记吧。
        </div>
      ) : (
        <div ref={wrapRef} className="relative h-[calc(100vh-11rem)] min-h-[420px] overflow-hidden rounded-xl border border-line bg-app">
          <Graph
            ref={fgRef}
            graphData={graphData}
            width={size.w}
            height={size.h}
            backgroundColor="#1e1e1e"
            nodeLabel={(n) => {
              const d = n as unknown as GNode;
              return `<div style="max-width:280px;font:13px sans-serif;padding:6px 9px;background:#262626;color:#dadada;border:1px solid #3f3f3f;border-radius:6px">
                <b>${d.title}</b><br/>
                <span style="color:#999">${d.documentTitle ?? ''}</span><br/>
                记忆 ${Math.round(d.memory * 100)}% · 阅读 ${d.viewCount} 次 · 累计 ${formatDuration(d.readingMs)}
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
          />
          <span className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted/60">
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
        <span className="tabular-nums text-muted/60">{value}</span>
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
      {hint && <span className="block text-[11px] text-muted/60">{hint}</span>}
    </label>
  );
}
