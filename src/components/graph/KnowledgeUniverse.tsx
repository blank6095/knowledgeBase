'use client';

/**
 * Knowledge Universe 容器（阶段 1：沉浸式图谱）。
 *
 * 职责：业务数据加载、三层视图状态、顶部浮层/悬浮导航/图例/详情面板编排、
 * 单击选中 + 双击进入语义、双选 AI 解释、设置面板（筛选/分组/显示/力）。
 * 画布渲染见 GraphCanvas；点击意图纯逻辑见 `@/lib/graph/click-intent`。
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { api } from '@/lib/client';
import { MEMORY_TIER_META } from '@/components/MemoryBadge';
import { memoryColor, MEMORY_TIER_ORDER } from '@/lib/memory';
import { Skeleton } from '@/components/Skeleton';
import { manyBodyThetaFor } from '@/lib/graph/mount-utils';
import type { GraphPayload } from '@/lib/graph/graph-types';
import { buildSearchIndex, reasonLabel, searchGraph } from '@/lib/graph/graph-search';
import { collectNeighborIds, pathEdgeKey, shortestPath } from '@/lib/graph/graph-focus';
import { filterEmptyHint, summarizeGraphFilter } from '@/lib/graph/graph-filter-empty';
import {
  computeMapMarks,
  countMapMarks,
  MAP_MARK_META,
  type MapMarkFlags,
  type MapMarkType,
  type TodayLearningLite,
} from '@/lib/graph/graph-map';
import {
  DOUBLE_CLICK_THRESHOLD_MS,
  isDoubleClick,
  nextClickRecord,
  type ClickRecord,
} from '@/lib/graph/click-intent';
import {
  applyForces,
  buildAdjacency,
  buildGraphData,
  computeHoverSet,
  computeLabelIds,
  computeMatchedIds,
  computeNodePaints,
  computeSearchNeighborIds,
  createInitialInteractionState,
  createInitialVisualState,
  KINDS,
  TABS,
  type CanvasNode,
  type ConnectData,
  type FGInstance,
  type Forces,
  type GraphLink,
  type TabKey,
} from '@/lib/graph/graph-state';
import GraphCanvas from './GraphCanvas';
import { type GraphContextMenuAction } from './GraphContextMenu';
import GraphDetailPanel from './GraphDetailPanel';
import { useGraphDetail } from './useGraphDetail';
import GraphLegend from './GraphLegend';
import { type GraphNavItem } from './GraphNavigation';
import GraphOverlays from './GraphOverlays';
import GraphThemePanel from './GraphThemePanel';
import {
  applyGraphEnvironment,
  DEFAULT_GRAPH_PREFERENCES,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
} from '@/lib/graph/graph-theme';
import {
  getGraphPreferencesSnapshot,
  getGraphViewPreferencesSnapshot,
  getServerGraphPreferencesSnapshot,
  getServerGraphViewPreferencesSnapshot,
  resetGraphPreferences,
  subscribeGraphPreferences,
  subscribeGraphViewPreferences,
  updateGraphPreferences,
  updateGraphViewPreferences,
} from '@/lib/graph/graph-preferences';

const KIND_LABELS: Record<string, string> = { wiki: '双链', tag: '标签', doc: '同文档' };

/** 初始状态只构造一次；状态更新全部走 setState 替换，不做原地修改。 */
const INITIAL_VISUAL = createInitialVisualState();
const INITIAL_INTERACTION = createInitialInteractionState();

/** 力参数是否等于默认值（决定水合后是否需要把已存参数覆盖到引擎）。 */
function sameForces(a: Forces, b: Forces): boolean {
  return (
    a.center === b.center &&
    a.charge === b.charge &&
    a.linkStrength === b.linkStrength &&
    a.linkDistance === b.linkDistance
  );
}

/** 水合探测订阅：无外部事件，仅用于第一次客户端提交后把快照切到 true。 */
const subscribeHydration = () => () => {};

export default function KnowledgeUniverse() {
  const router = useRouter();

  // ---- 业务数据层（/api/graph 或 ?fixture= 压测数据，只读） ----
  const [nodes, setNodes] = useState<CanvasNode[] | null>(null);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [error, setError] = useState('');
  // 压测模式：?fixture=<name> 加载 /fixtures/<name>.json（由 scripts/gen-graph-data.mjs 生成）。
  const [fixture, setFixture] = useState<string | null>(null);
  /** 重新加载用的自增键：错误/慢网时由用户触发，effect 依赖它重跑 */
  const [reloadKey, setReloadKey] = useState(0);
  /** 慢网提示：10s 仍未返回时给出「重新加载」出口（移动端 2MB+ 图谱弱网下常见） */
  const [slowLoad, setSlowLoad] = useState(false);

  // ---- 视觉状态层 ----
  const [panelOpen, setPanelOpen] = useState(INITIAL_INTERACTION.panelOpen);
  /** 移动端「更多操作」下拉：桌面三个动作按钮在 <md 收起进这里 */
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<TabKey>(INITIAL_INTERACTION.tab);
  /**
   * UX-29：筛选/分组/显示/力参数由 `graph-preferences` 的视图 store 持有并持久化，
   * 这里只保留「新增分组」草稿与「暂停动画」这类会话态。
   */
  const [newGroupQuery, setNewGroupQuery] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#e8b04b');
  const [paused, setPaused] = useState(INITIAL_VISUAL.paused);

  // ---- 交互状态层 ----
  const [searchKw, setSearchKw] = useState(INITIAL_INTERACTION.searchKw);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(INITIAL_INTERACTION.compareMode);
  const [compareIds, setCompareIds] = useState<string[]>(INITIAL_INTERACTION.compareIds);
  const [connectBusy, setConnectBusy] = useState(INITIAL_INTERACTION.connectBusy);
  const [connectError, setConnectError] = useState(INITIAL_INTERACTION.connectError);
  const [connectData, setConnectData] = useState<ConnectData | null>(null);
  // 阶段 2：搜索浮层（Ctrl/Cmd+K）；查询只影响视图，不请求接口、不改 nodes/links
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ---- U1-5/U1-6：选中详情、一阶关联高亮、单击/双击判定 ----
  /** U4-1 局部探索：0=收起，1=一阶，2=二阶 */
  const [focusDepth, setFocusDepth] = useState<0 | 1 | 2>(0);
  /** U4-2 双节点路径默认高亮，可手动清除 */
  const [pathVisible, setPathVisible] = useState(true);
  /** U4-5 节点右键/长按菜单（视口坐标） */
  const [contextMenu, setContextMenu] = useState<{ node: CanvasNode; x: number; y: number } | null>(null);
  /** U4-3 学习地图：四类标记独立通道（外圈/弧/点线），不改记忆度颜色与节点大小 */
  const [mapTypes, setMapTypes] = useState<Record<MapMarkType, boolean>>({ weak: false, due: false, today: false, hub: false });
  const [todayItems, setTodayItems] = useState<TodayLearningLite[]>([]);
  const [todayError, setTodayError] = useState(false);
  /** U3：外观偏好走外部 store（localStorage + useSyncExternalStore），避免 effect 内 setState */
  const preferences = useSyncExternalStore(
    subscribeGraphPreferences,
    getGraphPreferencesSnapshot,
    getServerGraphPreferencesSnapshot,
  );
  /**
   * UX-29：筛选/分组/显示/力参数同样走外部 store（localStorage + useSyncExternalStore），
   * 与外观偏好分开存 key，旧数据缺失时整组回默认值。
   */
  const viewPreferences = useSyncExternalStore(
    subscribeGraphViewPreferences,
    getGraphViewPreferencesSnapshot,
    getServerGraphViewPreferencesSnapshot,
  );
  /**
   * 水合前一律渲染默认外观，保证 SSR 与首帧客户端输出一致；水合后再切到已保存偏好。
   * getServerSnapshot=false / getSnapshot=true 的订阅稳定，不会触发重复渲染。
   */
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const environment = hydrated ? preferences.environment : DEFAULT_GRAPH_PREFERENCES.environment;
  const nodeStyle = hydrated ? preferences.nodeStyle : DEFAULT_GRAPH_PREFERENCES.nodeStyle;
  const glow = hydrated ? preferences.glow : DEFAULT_GRAPH_PREFERENCES.glow;
  const background = hydrated ? preferences.background : DEFAULT_GRAPH_PREFERENCES.background;
  // 视图偏好同理：水合前用画布初始值，水合后再切到 localStorage 里的已存偏好
  const tierOn = hydrated ? viewPreferences.tierOn : INITIAL_VISUAL.tierOn;
  const kindOn = hydrated ? viewPreferences.kindOn : INITIAL_VISUAL.kindOn;
  const groups = hydrated ? viewPreferences.groups : INITIAL_VISUAL.groups;
  const arrows = hydrated ? viewPreferences.arrows : INITIAL_VISUAL.arrows;
  const fadeThreshold = hydrated ? viewPreferences.fadeThreshold : INITIAL_VISUAL.fadeThreshold;
  const sizeMult = hydrated ? viewPreferences.sizeMult : INITIAL_VISUAL.sizeMult;
  const linkWidthMult = hydrated ? viewPreferences.linkWidthMult : INITIAL_VISUAL.linkWidthMult;
  const forces = hydrated ? viewPreferences.forces : INITIAL_VISUAL.forces;
  const clickRef = useRef<ClickRecord | null>(null);
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fgRef = useRef<FGInstance | null>(null);
  const forcesTouched = useRef(false);
  /** 已存力参数是否已在水合后套用（默认值不套用，避免无意义重热） */
  const restoredForces = useRef(false);
  const groupId = useRef(0);
  const tooltipCache = useRef(new Map<string, string>());
  /** 记录本次拖拽是否已重热，避免每个 pointermove 都把布局重置为满能量 */
  const draggingNodeId = useRef<string | null>(null);

  /**
   * 选中详情的状态机（选中/拉取/缓存/竞态防护/失效）收在 useGraphDetail 里，
   * 容器只负责「选中哪个节点」与「把结果交给详情面板」。
   */
  const nodeTitleOf = useCallback(
    (id: string) => nodes?.find((node) => node.id === id)?.title,
    [nodes],
  );
  const resetFocusDepth = useCallback(() => setFocusDepth(0), []);
  const { selectedId, detail, selectNode, closeDetail, invalidateDetail } = useGraphDetail(
    nodeTitleOf,
    resetFocusDepth,
  );

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('fixture');
    let cancelled = false;
    // 慢网兜底：旧实现只有骨架屏，弱网下用户无法区分「仍在加载」与「已经卡死」。
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlowLoad(true);
    }, 10_000);
    api<GraphPayload>(f ? `/fixtures/${f}.json` : '/api/graph')
      .then((d) => {
        if (cancelled) return;
        tooltipCache.current.clear();
        setFixture(f);
        setNodes(d.nodes);
        setLinks(d.edges);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '图谱加载失败');
      })
      .finally(() => clearTimeout(slowTimer));
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [reloadKey]);

  // U3-5：水合后应用环境到 <html data-graph-env>（只切 CSS，不请求、不重排）
  useEffect(() => {
    if (!hydrated) return;
    applyGraphEnvironment(preferences.environment);
  }, [hydrated, preferences.environment]);

  const changeEnvironment = (id: GraphEnvironmentId) => updateGraphPreferences({ environment: id });
  const changeNodeStyle = (id: GraphNodeStyleId) => updateGraphPreferences({ nodeStyle: id });
  const changeGlow = (value: number) => updateGraphPreferences({ glow: value });
  const changeBackground = (value: number) => updateGraphPreferences({ background: value });
  const resetAppearance = () => resetGraphPreferences();
  /** U-6：全站「外观主题」入口跳 `/graph?panel=theme` 时打开设置面板并切到主题 tab */
  const openThemePanel = useCallback(() => {
    setPanelOpen(true);
    setTab('主题');
  }, []);
  /** UX-28：筛选全空后的复位——恢复默认勾选并清空关键词（持久化同步更新） */
  const resetFilters = () => {
    updateGraphViewPreferences({
      tierOn: { ...INITIAL_VISUAL.tierOn },
      kindOn: { ...INITIAL_VISUAL.kindOn },
    });
    setSearchKw('');
  };
  const toggleMapType = (type: MapMarkType) => setMapTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  const setAllMapTypes = (on: boolean) => setMapTypes({ weak: on, due: on, today: on, hub: on });

  // 卸载时清理单击延迟定时器
  useEffect(
    () => () => {
      if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
    },
    [],
  );

  // 移动端「更多操作」下拉：点外部或按 Esc 收起
  useEffect(() => {
    if (!actionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && actionsMenuRef.current?.contains(event.target)) return;
      setActionsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actionsOpen]);

  const adjacency = useMemo(() => buildAdjacency(links), [links]);
  // 旧「筛选」面板关键词（保留兼容）；浮层搜索激活时优先用浮层命中集合
  const legacyMatchedIds = useMemo(() => computeMatchedIds(nodes, searchKw), [nodes, searchKw]);
  const searchIndex = useMemo(() => buildSearchIndex(nodes ?? []), [nodes]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResult = useMemo(
    () => searchGraph(searchIndex, deferredSearchQuery),
    [searchIndex, deferredSearchQuery],
  );
  const searchActive = deferredSearchQuery.trim().length > 0;
  const matchedIds = searchActive ? searchResult.matchedIds : legacyMatchedIds;
  const neighborIds = useMemo(
    () => (searchActive ? computeSearchNeighborIds(searchResult.matchedIds, adjacency) : null),
    [searchActive, searchResult, adjacency],
  );
  const searchResults = useMemo(
    () =>
      searchResult.hits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        reason: reasonLabel(hit.reason),
        detail: hit.detail,
      })),
    [searchResult],
  );
  const hoverSet = useMemo(() => computeHoverSet(hoverId, adjacency), [hoverId, adjacency]);

  // U4-3 学习地图：只有启用标记时才拉取今日学习（失败降级为仅薄弱/枢纽）
  const mapEnabled = Object.values(mapTypes).some(Boolean);
  useEffect(() => {
    if (!mapEnabled) return;
    let cancelled = false;
    api<{ items?: { segmentId?: unknown; reasonCode?: unknown }[] }>('/api/learning/today')
      .then((data) => {
        if (cancelled) return;
        const rows: TodayLearningLite[] = [];
        for (const item of data.items ?? []) {
          if (typeof item.segmentId === 'string' && typeof item.reasonCode === 'string') {
            rows.push({ segmentId: item.segmentId, reasonCode: item.reasonCode });
          }
        }
        setTodayItems(rows);
        setTodayError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setTodayItems([]);
          setTodayError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapEnabled]);

  const mapMarks = useMemo<Map<string, MapMarkFlags> | null>(() => {
    if (!mapEnabled || !nodes) return null;
    const all = computeMapMarks(nodes, adjacency, todayItems);
    const filtered = new Map<string, MapMarkFlags>();
    for (const [id, flags] of all) {
      const next: MapMarkFlags = { ...flags };
      for (const type of Object.keys(next) as MapMarkType[]) {
        if (!mapTypes[type]) next[type] = false;
      }
      if (Object.values(next).some(Boolean)) filtered.set(id, next);
    }
    return filtered;
  }, [mapEnabled, nodes, adjacency, todayItems, mapTypes]);
  const mapCounts = useMemo(
    () => (mapMarks ? countMapMarks(mapMarks) : { weak: 0, due: 0, today: 0, hub: 0 }),
    [mapMarks],
  );

  const deferredTierOn = useDeferredValue(tierOn);
  const deferredKindOn = useDeferredValue(kindOn);
  const graphData = useMemo(
    () => buildGraphData(nodes, links, deferredTierOn, deferredKindOn),
    [nodes, links, deferredTierOn, deferredKindOn],
  );
  /**
   * UX-28：空态按「筛选后」节点数判断。原始 nodes 为空才是「还没有数据」，
   * 有数据但筛选后为空则走「无匹配节点 + 重置筛选」。
   */
  const filterSummary = useMemo(
    () => summarizeGraphFilter(nodes?.length ?? 0, graphData.nodes.length),
    [nodes, graphData.nodes.length],
  );

  // U4-1 局部探索：选中节点 + depth 阶邻居（二阶上限 300 节点）
  const focusIds = useMemo(() => {
    if (focusDepth === 0 || !selectedId) return null;
    return collectNeighborIds(new Set([selectedId]), adjacency, focusDepth, 300);
  }, [focusDepth, selectedId, adjacency]);

  // U4-2 双节点最短路径：选中两个节点时自动计算（无向 BFS），可清除高亮
  const comparePath = useMemo(
    () => (compareMode && compareIds.length === 2 ? shortestPath(links, compareIds[0], compareIds[1]) : null),
    [compareMode, compareIds, links],
  );
  const pathNodeIds = useMemo(
    () => (pathVisible && comparePath ? new Set(comparePath.nodeIds) : null),
    [pathVisible, comparePath],
  );
  const pathEdgeKeys = useMemo(
    () =>
      pathVisible && comparePath
        ? new Set(comparePath.edges.map((edge) => pathEdgeKey(edge.source, edge.target)))
        : null,
    [pathVisible, comparePath],
  );
  const pathSummary = useMemo(() => {
    if (!comparePath) return null;
    const titleById = new Map((nodes ?? []).map((node) => [node.id, node.title]));
    return comparePath.nodeIds.map((id) => titleById.get(id) ?? id).join(' → ');
  }, [comparePath, nodes]);
  const pathKinds = comparePath?.edges.map((edge) => KIND_LABELS[edge.kind] ?? edge.kind).join(' / ') ?? null;

  // UX-29：水合后若存有自定义力参数，先标记「用户已改动」，再由下面的引擎恢复逻辑套用。
  useEffect(() => {
    if (!hydrated || restoredForces.current) return;
    restoredForces.current = true;
    if (sameForces(viewPreferences.forces, INITIAL_VISUAL.forces)) return;
    forcesTouched.current = true;
    if (fgRef.current) applyForces(fgRef.current, viewPreferences.forces);
  }, [hydrated, viewPreferences.forces]);

  // 引擎随 graphData 变更重建后，恢复力参数、规模自适应 theta 与暂停态。
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as { theta?: (value: number) => void } | undefined;
    charge?.theta?.(manyBodyThetaFor(graphData.nodes.length));
    if (forcesTouched.current) applyForces(fg, forces);
    if (paused) fg.pauseAnimation();
  }, [graphData.nodes.length, forces, paused]);

  const nodePaints = useMemo(() => computeNodePaints(graphData.nodes, groups), [graphData.nodes, groups]);
  const labelIds = useMemo(
    () => computeLabelIds(hoverId, adjacency, graphData.nodes),
    [hoverId, adjacency, graphData.nodes],
  );

  /** 重新拉取图谱：清错误、回到骨架屏并重跑 effect（错误态与慢网提示共用） */
  const reloadGraph = () => {
    setError('');
    setSlowLoad(false);
    setNodes(null);
    setLinks([]);
    setReloadKey((key) => key + 1);
  };

  if (error) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-canvas px-6">
        <div className="card w-full max-w-sm px-6 py-8 text-center" role="alert">
          <p className="font-display text-subtitle text-primary">图谱没能加载</p>
          <p className="mt-2 break-words text-minor text-danger">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={reloadGraph}
              className="min-h-11 rounded-lg bg-accent px-4 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
            >
              重新加载
            </button>
            <Link
              href="/notes"
              className="flex min-h-11 items-center rounded-lg border border-line px-4 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              返回知识库
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const onForce = (patch: Partial<Forces>) => {
    const next = { ...forces, ...patch };
    forcesTouched.current = true;
    // UX-29：力参数同样持久化（写 store 即落盘）
    updateGraphViewPreferences({ forces: next });
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

  const onNodeDrag = (node: CanvasNode) => {
    if (draggingNodeId.current === node.id) return;
    draggingNodeId.current = node.id;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3ReheatSimulation();
    if (paused) fg.resumeAnimation();
  };

  const onNodeDragEnd = () => {
    draggingNodeId.current = null;
    if (paused) fgRef.current?.pauseAnimation();
  };

  const toggleCompare = (id: string) => {
    setConnectError('');
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length >= 2 ? [current[1], id] : [...current, id];
    });
  };

  const explainConnection = async () => {
    if (compareIds.length !== 2 || connectBusy) return;
    setConnectBusy(true);
    setConnectError('');
    try {
      const data = await api<ConnectData>('/api/ai/connect', {
        method: 'POST',
        body: JSON.stringify({ segmentIds: compareIds }),
      });
      setConnectData(data);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : '关联解释失败');
    } finally {
      setConnectBusy(false);
    }
  };

  const addGroup = () => {
    const q = newGroupQuery.trim();
    if (!q) return;
    groupId.current += 1;
    updateGraphViewPreferences({ groups: [...groups, { id: groupId.current, query: q, color: newGroupColor }] });
    setNewGroupQuery('');
  };

  /**
   * 单击/双击分流（U1-6）：
   * - compareMode 优先，保持双选语义；
   * - 同节点 280ms 内双击 → 进入阅读；
   * - 单击延迟 280ms 再选中，避免双击时面板闪一下。
   */
  const onNodeClick = (node: CanvasNode) => {
    setContextMenu(null);
    if (compareMode) {
      toggleCompare(node.id);
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const doubleClick = isDoubleClick(clickRef.current, node.id, now);
    clickRef.current = nextClickRecord(clickRef.current, node.id, now);
    if (doubleClick) {
      clickRef.current = null;
      if (singleClickTimer.current) {
        clearTimeout(singleClickTimer.current);
        singleClickTimer.current = null;
      }
      router.push(`/segments/${node.id}`);
      return;
    }
    if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
    singleClickTimer.current = setTimeout(() => {
      singleClickTimer.current = null;
      selectNode(node.id);
    }, DOUBLE_CLICK_THRESHOLD_MS);
  };

  /** U2-4：把视口平滑移到搜索结果节点（250–400ms，不触发重排/请求）。 */
  const focusSearchResult = (id: string) => {
    const node = graphData.nodes.find((item) => item.id === id);
    const fg = fgRef.current;
    if (!node || !fg) return;
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
    fg.centerAt(node.x, node.y, 300);
    fg.zoom(1.8, 300);
  };

  /**
   * U4-5：右键/长按菜单动作。
   * UX-11：「标记为重要」「加入今日学习」没有数据模型与接口支撑，已从菜单移除，
   * 不再保留误导性的 disabled 占位项（如日后接入学习计划，再按真实能力加回）。
   */
  const contextMenuActions: GraphContextMenuAction[] = contextMenu
    ? [
        {
          key: 'focus',
          label: '聚焦该节点',
          onSelect: () => {
            const id = contextMenu.node.id;
            setContextMenu(null);
            selectNode(id);
            focusSearchResult(id);
          },
        },
        {
          key: 'neighbors-1',
          label: '展开一阶关联',
          onSelect: () => {
            const id = contextMenu.node.id;
            setContextMenu(null);
            selectNode(id);
            setFocusDepth(1);
          },
        },
        {
          key: 'neighbors-2',
          label: '展开二阶关联',
          onSelect: () => {
            const id = contextMenu.node.id;
            setContextMenu(null);
            selectNode(id);
            setFocusDepth(2);
          },
        },
        {
          key: 'read',
          label: '阅读知识点',
          onSelect: () => {
            const id = contextMenu.node.id;
            setContextMenu(null);
            // UX-30：阅读会更新记忆度，回图谱后详情需重新拉取
            invalidateDetail(id);
            router.push(`/segments/${id}`);
          },
        },
        {
          key: 'edit',
          label: '编辑知识点',
          onSelect: () => {
            const id = contextMenu.node.id;
            setContextMenu(null);
            // UX-30：编辑后标题/摘要会变化，先让缓存失效
            invalidateDetail(id);
            router.push(`/segments/${id}#edit`);
          },
        },
      ]
    : [];

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const navItems: GraphNavItem[] = [
    { key: 'universe', label: '知识宇宙', href: '/graph', active: true },
    { key: 'library', label: '知识库', href: '/notes' },
    { key: 'today', label: '今日学习', href: '/' },
    { key: 'progress', label: '学习复盘', href: '/progress' },
    { key: 'assistant', label: 'AI 助手', href: '/ask' },
    {
      key: 'appearance',
      label: '外观主题',
      active: panelOpen && tab === '主题',
      onSelect: openThemePanel,
    },
    { key: 'settings', label: '设置', href: '/settings' },
  ];

  const legendTiers = MEMORY_TIER_ORDER.map((tier) => ({
    label: MEMORY_TIER_META[tier].label,
    color: MEMORY_TIER_META[tier].dot,
  }));
  const legendGradient = [memoryColor(0.05), memoryColor(0.5), memoryColor(1)];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-canvas">
      {/*
        U-6：全站「外观主题」入口跳 `/graph?panel=theme`。
        useSearchParams 在预渲染路由里必须在 Suspense 边界内（Next 16 约定），
        否则 `next build` 会报 Missing Suspense boundary。
      */}
      <Suspense fallback={null}>
        <ThemePanelParamSync onOpenTheme={openThemePanel} />
      </Suspense>
      {/* 页面级主标题：视觉上由顶栏品牌承担，这里保留无障碍标题（也兼容既有 E2E 断言） */}
      <h1 className="sr-only">关系图谱</h1>
      {nodes === null ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
          role="status"
          aria-live="polite"
          aria-label="加载中"
        >
          <div className="w-64 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          {slowLoad && (
            <>
              <p className="text-minor text-muted">网络较慢，图谱仍在加载…</p>
              <button
                type="button"
                onClick={reloadGraph}
                className="min-h-11 rounded-lg border border-line px-4 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
              >
                重新加载
              </button>
            </>
          )}
        </div>
      ) : filterSummary.status === 'no-data' ? (
        <div className="flex h-full items-center justify-center px-6">
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
        </div>
      ) : (
        <>
          <GraphCanvas
            graphData={graphData}
            nodePaints={nodePaints}
            visual={{ arrows, fadeThreshold, sizeMult, linkWidthMult, nodeStyle, glowMult: glow }}
            interaction={{
              matchedIds,
              hoverSet,
              hoverId,
              compareIds,
              labelIds,
              focusIds,
              neighborIds,
              pathNodeIds,
              pathEdgeKeys,
              mapMarks,
            }}
            fgRef={fgRef}
            tooltipCache={tooltipCache}
            graphEnv={environment}
            graphEnvIntensity={background}
            onNodeClick={onNodeClick}
            onNodeHover={(node) => setHoverId(node ? node.id : null)}
            onNodeDrag={onNodeDrag}
            onNodeDragEnd={onNodeDragEnd}
            onBackgroundClick={closeDetail}
            onNodeContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
          >
            {compareMode && (
              <div className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-20 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-line bg-elevated/95 px-4 py-3 shadow-2xl backdrop-blur md:bottom-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-tag text-muted">
                    已选 {compareIds.length}/2
                    {compareIds.length > 0 &&
                      `：${compareIds.map((id) => nodes?.find((node) => node.id === id)?.title ?? id).join(' ↔ ')}`}
                  </span>
                  <div className="flex-1" />
                  {comparePath && (
                    <button
                      onClick={() => setPathVisible((value) => !value)}
                      className="inline-flex min-h-11 items-center rounded-md px-2 text-tag text-muted hover:text-primary"
                    >
                      {pathVisible ? '清除路径' : '高亮路径'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setCompareMode(false);
                      setCompareIds([]);
                      setConnectError('');
                    }}
                    className="inline-flex min-h-11 items-center rounded-md px-2 text-tag text-muted hover:text-primary"
                  >
                    退出
                  </button>
                  {comparePath && (
                    <button
                      onClick={() => router.push(`/ask?path=${comparePath.nodeIds.join(',')}`)}
                      className="inline-flex min-h-11 items-center rounded-md border border-line px-2 text-tag text-muted hover:bg-surface-hover hover:text-primary"
                      title="把当前路径作为上下文带去 AI 助手"
                    >
                      问 AI
                    </button>
                  )}
                  <button
                    onClick={explainConnection}
                    disabled={compareIds.length !== 2 || connectBusy}
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-tag font-medium text-accent-ink hover:bg-accent-strong disabled:opacity-40"
                  >
                    {connectBusy ? '解释中…' : '解释关联'}
                  </button>
                </div>
                {compareIds.length === 2 && (
                  <p className={`mt-1 text-tag ${comparePath ? 'text-muted' : 'text-faint'}`}>
                    {comparePath
                      ? `路径：${pathSummary}${pathKinds ? `（${pathKinds}）` : ''}`
                      : '两个知识点之间没有路径'}
                  </p>
                )}
                {connectError && <p className="mt-1 text-tag text-danger">{connectError}</p>}
              </div>
            )}
          </GraphCanvas>

          {/*
            UX-28：有数据但被筛选全部隐藏时的空态。
            覆盖在画布上而不是替换整棵子树，保证「设置 → 筛选」面板仍然可达、可实时复位。
          */}
          {filterSummary.status === 'filtered-empty' && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
              <div className="card fade-up pointer-events-auto w-full max-w-sm px-6 py-7 text-center">
                <p className="font-display text-subtitle text-primary">无匹配节点</p>
                <p className="mt-2 text-minor text-muted" role="status">
                  当前筛选条件下没有可显示的知识点。
                  {filterEmptyHint(nodes?.length ?? 0, graphData.nodes.length)}。
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="min-h-11 rounded-lg bg-accent px-4 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
                  >
                    重置筛选
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanelOpen(true);
                      setTab('筛选');
                    }}
                    className="min-h-11 rounded-lg border border-line px-4 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
                  >
                    调整筛选
                  </button>
                </div>
              </div>
            </div>
          )}

          <GraphLegend tiers={legendTiers} gradient={legendGradient} />

          {mapEnabled && (
            <div className="absolute bottom-8 left-3 z-10 hidden flex-wrap gap-2 md:flex">
              {(Object.keys(MAP_MARK_META) as MapMarkType[])
                .filter((type) => mapTypes[type])
                .map((type) => (
                  <span
                    key={type}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface/85 px-2 py-0.5 text-tag text-muted backdrop-blur"
                  >
                    <i className="h-1.5 w-1.5 rounded-full" style={{ background: MAP_MARK_META[type].color }} />
                    {MAP_MARK_META[type].label} {mapCounts[type]}
                  </span>
                ))}
            </div>
          )}

          {/* 右侧动作簇：≥md 三个按钮直排；<md 收进「更多操作」下拉，避免遮挡画布 */}
          <div
            ref={actionsMenuRef}
            className="absolute right-safe-3 top-[calc(4rem+env(safe-area-inset-top))] z-20 md:right-4 md:top-16"
          >
            <div className="hidden items-center gap-2 md:flex">
              <button
                onClick={() => {
                  if (mapEnabled) {
                    setAllMapTypes(false);
                    setPanelOpen(false);
                    return;
                  }
                  setPanelOpen(true);
                  setTab('地图');
                }}
                aria-pressed={mapEnabled}
                className={`flex min-h-11 items-center rounded-lg border px-3 text-tag transition-colors duration-150 ${
                  mapEnabled
                    ? 'border-accent bg-accent/15 text-accent-strong'
                    : 'border-line bg-surface/90 text-muted backdrop-blur hover:bg-surface-hover hover:text-primary'
                }`}
              >
                {mapEnabled ? '◉ 关闭学习地图' : '◉ 学习地图'}
              </button>
              <button
                onClick={() => {
                  setCompareMode((value) => !value);
                  setCompareIds([]);
                  setConnectError('');
                }}
                className={`flex min-h-11 items-center rounded-lg border px-3 text-tag transition-colors duration-150 ${
                  compareMode
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-surface/90 text-muted backdrop-blur hover:bg-surface-hover hover:text-primary'
                }`}
              >
                联系两概念
              </button>
              <button
                onClick={() => setPanelOpen((o) => !o)}
                aria-label="关系图谱设置"
                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-body transition-colors duration-150 ${
                  panelOpen
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-surface/90 text-muted backdrop-blur hover:bg-surface-hover hover:text-primary'
                }`}
              >
                ⚙
              </button>
            </div>

            <div className="relative md:hidden">
              <button
                type="button"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((open) => !open)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg border backdrop-blur transition-colors duration-150 ${
                  actionsOpen
                    ? 'border-accent bg-accent/15 text-accent-strong'
                    : 'border-line bg-surface/90 text-muted hover:bg-surface-hover hover:text-primary'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>

              {actionsOpen && (
                <div
                  role="menu"
                  aria-label="更多操作"
                  className="absolute right-0 top-[calc(100%+0.5rem)] w-44 rounded-xl border border-line bg-elevated p-1 text-minor shadow-2xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      if (mapEnabled) {
                        setAllMapTypes(false);
                        setPanelOpen(false);
                        return;
                      }
                      setPanelOpen(true);
                      setTab('地图');
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-surface-hover ${
                      mapEnabled ? 'text-accent' : 'text-muted hover:text-primary'
                    }`}
                  >
                    <span aria-hidden>◉</span> {mapEnabled ? '关闭学习地图' : '学习地图'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      setCompareMode((value) => !value);
                      setCompareIds([]);
                      setConnectError('');
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-surface-hover ${
                      compareMode ? 'text-accent' : 'text-muted hover:text-primary'
                    }`}
                  >
                    <span aria-hidden>⇄</span> 联系两概念
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      setPanelOpen((o) => !o);
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-surface-hover ${
                      panelOpen ? 'text-accent' : 'text-muted hover:text-primary'
                    }`}
                  >
                    <span aria-hidden>⚙</span> 图谱设置
                  </button>
                </div>
              )}
            </div>
          </div>

          {panelOpen && (
            <div className="absolute right-safe-3 top-[calc(8rem+env(safe-area-inset-top))] z-30 max-h-[calc(100dvh-13rem-env(safe-area-inset-top))] w-[300px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line bg-elevated p-3 text-tag shadow-2xl md:right-4 md:top-32 md:max-h-[calc(100dvh-9rem)]">
              <div className="mb-3 flex items-center gap-1 border-b border-line pb-2">
                {/*
                  标签行改为横向可滚动（FE-006）：面板只有 300px 宽，
                  flex-1 会把每个标签压到 ~38px 宽，中文逐字换行。
                */}
                <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
                  {TABS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 transition-colors duration-150 ${
                        tab === t ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-hover hover:text-primary'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="关闭设置面板"
                  onClick={() => setPanelOpen(false)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                >
                  ✕
                </button>
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
                            onChange={(e) =>
                              updateGraphViewPreferences({ tierOn: { ...tierOn, [t]: e.target.checked } })
                            }
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
                            onChange={(e) =>
                              updateGraphViewPreferences({ kindOn: { ...kindOn, [k.kind]: e.target.checked } })
                            }
                          />
                          <span className="h-0.5 w-4 rounded" style={{ background: k.color }} />
                          {k.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-tag leading-relaxed text-faint">节点大小 = 关联数 · 悬停高亮邻接 · 单击查看详情 · 双击进入阅读 · 节点可拖拽</p>
                  <p className="text-tag leading-relaxed text-faint">筛选条件与分组会自动保存到本机，刷新后保留；搜索关键词仅本次会话生效。</p>
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
                        onChange={(e) =>
                          updateGraphViewPreferences({
                            groups: groups.map((x) => (x.id === g.id ? { ...x, color: e.target.value } : x)),
                          })
                        }
                        className="h-6 w-8 cursor-pointer rounded border border-line bg-app"
                        aria-label="分组颜色"
                      />
                      <input
                        value={g.query}
                        onChange={(e) =>
                          updateGraphViewPreferences({
                            groups: groups.map((x) => (x.id === g.id ? { ...x, query: e.target.value } : x)),
                          })
                        }
                        className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-minor text-primary outline-none transition-colors focus:border-accent"
                      />
                      <button
                        onClick={() => updateGraphViewPreferences({ groups: groups.filter((x) => x.id !== g.id) })}
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
                      className="inline-flex min-h-11 items-center rounded bg-accent px-2.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
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
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={arrows}
                        onChange={(e) => updateGraphViewPreferences({ arrows: e.target.checked })}
                      />
                      连线方向箭头
                    </label>
                    <button
                      onClick={togglePause}
                      className={`inline-flex min-h-11 items-center rounded-md border px-2 transition-colors duration-150 ${
                        paused ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line text-muted hover:bg-surface-hover hover:text-primary'
                      }`}
                    >
                      {paused ? '▶ 继续动画' : '⏸ 暂停动画'}
                    </button>
                  </div>
                  <p className="text-tag leading-relaxed text-faint">
                    显示参数会自动保存到本机；动画暂停状态仅本次会话生效。
                  </p>
                  <LabeledSlider label="文本褪色阈值" value={fadeThreshold} min={0.5} max={3} step={0.1} onChange={(v) => updateGraphViewPreferences({ fadeThreshold: v })} hint="缩放小于该值时标签淡出" />
                  <LabeledSlider label="节点大小" value={sizeMult} min={0.5} max={3} step={0.1} onChange={(v) => updateGraphViewPreferences({ sizeMult: v })} />
                  <LabeledSlider label="连线粗细" value={linkWidthMult} min={0.5} max={4} step={0.1} onChange={(v) => updateGraphViewPreferences({ linkWidthMult: v })} />
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

              {tab === '主题' && (
                <GraphThemePanel
                  environment={environment}
                  nodeStyle={nodeStyle}
                  glow={glow}
                  background={background}
                  onEnvironmentChange={changeEnvironment}
                  onNodeStyleChange={changeNodeStyle}
                  onGlowChange={changeGlow}
                  onBackgroundChange={changeBackground}
                  onReset={resetAppearance}
                />
              )}

              {tab === '地图' && (
                <div className="space-y-3">
                  <p className="leading-relaxed text-muted">
                    学习地图用独立的<b>外圈 / 弧线 / 点线</b>标记，不改变记忆度颜色与节点大小。
                  </p>
                  {(Object.keys(MAP_MARK_META) as MapMarkType[]).map((type) => {
                    const meta = MAP_MARK_META[type];
                    return (
                      <label
                        key={type}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-app/60 px-2.5 py-2 transition-colors hover:bg-surface-hover/60"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 accent-accent"
                          checked={mapTypes[type]}
                          onChange={() => toggleMapType(type)}
                        />
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2 text-primary">
                            {meta.label}
                            <span className="font-mono text-tag tabular-nums text-faint">
                              {mapEnabled ? mapCounts[type] : 0}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-tag leading-relaxed text-faint">{meta.description}</span>
                        </span>
                      </label>
                    );
                  })}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAllMapTypes(true)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-line px-2 text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                    >
                      全部显示
                    </button>
                    <button
                      onClick={() => setAllMapTypes(false)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-line px-2 text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                    >
                      清除标记
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAllMapTypes(false);
                      setPanelOpen(false);
                    }}
                    className="w-full rounded-md border border-accent bg-accent/10 px-2 py-2 text-accent-strong transition-colors hover:bg-accent/20"
                  >
                    关闭学习地图
                  </button>
                  {todayError && <p className="text-warn">今日学习数据加载失败，仅显示薄弱 / 枢纽。</p>}
                  <p className="text-tag leading-relaxed text-faint">
                    枢纽口径：关联度数 Top 10%（至少 1 个、度数 ≥2）；到期/今日来自 `/api/learning/today`；薄弱阈值 memory &lt; 40%。
                  </p>
                  <p className="text-tag leading-relaxed text-faint">学习地图标记仅本次会话生效，不写入本地偏好。</p>
                </div>
              )}
            </div>
          )}

          {selectedId && detail && (
            <GraphDetailPanel
              status={detail.status}
              data={detail.data}
              error={detail.error}
              title={detail.title}
              focusDepth={focusDepth}
              onClose={closeDetail}
              onRetry={() => selectNode(selectedId)}
              onRead={() => {
                invalidateDetail(selectedId);
                router.push(`/segments/${selectedId}`);
              }}
              onReview={() => {
                // 复习会改变记忆度，返回图谱后详情需重新拉取
                invalidateDetail(selectedId);
                router.push(`/study/${selectedId}`);
              }}
              onEdit={() => {
                invalidateDetail(selectedId);
                router.push(`/segments/${selectedId}#edit`);
              }}
              onCycleFocus={() => setFocusDepth((depth) => (depth === 0 ? 1 : depth === 1 ? 2 : 0))}
              onAsk={() => router.push(selectedId ? `/ask?segment=${selectedId}` : '/ask')}
              onSelectNeighbor={(id) => selectNode(id)}
            />
          )}

          <span className="pointer-events-none absolute bottom-2 left-3 z-10 hidden text-tag text-faint md:block">
            节点大小 = 关联数 · 单击查看详情 · 双击进入阅读
          </span>
        </>
      )}

      <GraphOverlays
        nodeCount={nodes?.length ?? 0}
        edgeCount={links.length}
        fixture={fixture}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onSearchOpenChange={setSearchOpen}
        onSearchQueryChange={setSearchQuery}
        onSearchSelect={(id) => {
          // UX-10：选中即达——关闭浮层、清空关键词、移动相机并打开节点详情
          setContextMenu(null);
          setSearchOpen(false);
          setSearchQuery('');
          focusSearchResult(id);
          selectNode(id);
        }}
        onSearchClear={() => setSearchQuery('')}
        navItems={navItems}
        onLogout={logout}
        contextMenu={contextMenu}
        contextMenuActions={contextMenuActions}
        onContextMenuClose={() => setContextMenu(null)}
        connectData={connectData}
        onConnectClose={() => setConnectData(null)}
      />
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

/**
 * U-6：读取 `/graph?panel=theme`（全站「外观主题」入口的跳转契约）。
 *
 * 使用 `useSearchParams` 时必须在 Suspense 边界内（Next 16 的预渲染约定），
 * 边界由调用方的 `<Suspense fallback={null}>` 提供。
 *
 * 依赖 `panel` 字符串而不是 searchParams 对象引用：关闭面板不会改变 URL，
 * 也就不会触发 effect 再次自动打开。
 */
function ThemePanelParamSync({ onOpenTheme }: { onOpenTheme: () => void }) {
  const searchParams = useSearchParams();
  const panel = searchParams.get('panel');
  useEffect(() => {
    if (panel === 'theme') onOpenTheme();
  }, [panel, onOpenTheme]);
  return null;
}
