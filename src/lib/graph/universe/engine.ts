/**
 * 知识宇宙内核编排层：把状态机、数据适配、视觉编码、空间索引与渲染组合起来。
 *
 * 设计约束（执行版任务清单 v1.2）：
 * - 不 import 任何现有业务模块、不接入页面、不改 API / DB / 核心计算；
 * - 零新增依赖，纯 TypeScript + 浏览器原生 Canvas 2D；
 * - DEC-01 通过 setTokens({ decisionPolicy }) 注入 T02 评审结论，
 *   内核不预设保留或移除；
 * - 所有对外状态只读，绘制指令可缓存且确定性。
 */

import {
  createVisualFacts,
  indexTodayLearning,
  type GraphNodeRecord,
  type NodeFacts,
  type TodayLearningRecord,
} from './data';
import { createInitialState, reduceUniverseState, type UniverseAction, type UniverseState } from './state';
import {
  buildDrawList,
  paintDrawList,
  type DrawList,
  type SceneEdge,
  type SceneNode,
  type UniverseScene,
  type Viewport,
} from './renderer';
import { SpatialHash, type IndexedNode } from './spatial-index';
import { createTokens, type ChannelId, type UniverseTokens, type UniverseTokensInput } from './tokens';
import { encodeEdge, encodeNode } from './visual';

export interface UniverseNodeInput extends GraphNodeRecord, IndexedNode {
  /** 关联数，仅用于节点大小；不得用于推断掌握或待复习 */
  readonly degree: number;
}

export interface UniverseEdgeInput {
  readonly source: string;
  readonly target: string;
  readonly kind: 'wiki' | 'tag' | 'doc';
}

export interface UniverseEngineOptions {
  readonly tokens?: UniverseTokensInput;
  readonly cellSize?: number;
  readonly onStateChange?: (state: UniverseState) => void;
}

export interface UniverseEngine {
  dispatch(action: UniverseAction): void;
  getState(): UniverseState;
  getTokens(): UniverseTokens;
  setTokens(input: UniverseTokensInput): void;
  setGraph(
    nodes: readonly UniverseNodeInput[],
    edges: readonly UniverseEdgeInput[],
    today?: readonly TodayLearningRecord[],
  ): void;
  setViewport(viewport: Viewport): void;
  hitTest(x: number, y: number, padding?: number): UniverseNodeInput | null;
  buildFrame(frame?: number): DrawList;
  render(ctx: CanvasRenderingContext2D, frame?: number): readonly string[];
  getPendingChannels(): readonly ChannelId[];
  getFacts(id: string): NodeFacts | undefined;
  destroy(): void;
}

const EMPTY_SCENE: UniverseScene = Object.freeze({
  nodes: Object.freeze([]) as readonly SceneNode[],
  edges: Object.freeze([]) as readonly SceneEdge[],
});

const DEFAULT_VIEWPORT: Viewport = Object.freeze({
  width: 1440,
  height: 900,
  dpr: 2,
  centerX: 0,
  centerY: 0,
  zoom: 1,
});

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function createUniverseEngine(options: UniverseEngineOptions = {}): UniverseEngine {
  let tokens = createTokens(options.tokens ?? {});
  let state = createInitialState();
  let viewport = DEFAULT_VIEWPORT;
  let scene: UniverseScene = EMPTY_SCENE;
  let nodes: readonly UniverseNodeInput[] = Object.freeze([]) as readonly UniverseNodeInput[];
  let edges: readonly UniverseEdgeInput[] = Object.freeze([]) as readonly UniverseEdgeInput[];
  let today = new Map<string, TodayLearningRecord>();
  let facts = new Map<string, NodeFacts>();
  let version = 0;
  let cachedFrame: { readonly signature: string; readonly list: DrawList } | null = null;

  const index = new SpatialHash<UniverseNodeInput>(options.cellSize ?? 96);

  function rebuildFacts(now: number): void {
    const next = new Map<string, NodeFacts>();
    for (const node of nodes) {
      next.set(node.id, createVisualFacts(node, today.get(node.id), tokens.decisionPolicy, now));
    }
    facts = next;
    version += 1;
    cachedFrame = null;
  }

  function rebuildScene(): void {
    const matched = new Set(state.context.matchedIds);
    const selectedId = state.context.selectedNodeId;
    const hasQuery = state.context.query.length > 0;
    const endpoints = state.context.pathEndpoints;
    const endpointSet = endpoints ? new Set(endpoints) : null;

    const sceneNodes: SceneNode[] = nodes.map((node) => {
      const nodeFacts = facts.get(node.id);
      if (!nodeFacts) return null;
      const selected = node.id === selectedId;
      const paint = encodeNode(
        nodeFacts,
        { hasQuery, matched: matched.has(node.id), selected, zoom: viewport.zoom },
        tokens,
      );
      return {
        id: node.id,
        x: node.x,
        y: node.y,
        radius: tokens.node.baseRadius + Math.sqrt(Math.max(0, node.degree)) * tokens.node.radiusPerDegree,
        degree: node.degree,
        paint,
      } satisfies SceneNode;
    }).filter((node): node is SceneNode => node !== null);

    const sceneEdges: SceneEdge[] = edges.map((edge) => {
      const key = edgeKey(edge.source, edge.target);
      const bothMatched = matched.has(edge.source) && matched.has(edge.target);
      const onPath = endpointSet
        ? endpointSet.has(edge.source) || endpointSet.has(edge.target)
        : false;
      const emphasized = Boolean(hasQuery && bothMatched) || Boolean(endpointSet && onPath);
      const dimmed = hasQuery && !bothMatched && !emphasized;
      return {
        source: edge.source,
        target: edge.target,
        key,
        paint: encodeEdge({ emphasized, dimmed }, tokens),
      } satisfies SceneEdge;
    });

    scene = Object.freeze({
      nodes: Object.freeze(sceneNodes) as readonly SceneNode[],
      edges: Object.freeze(sceneEdges) as readonly SceneEdge[],
    });
    version += 1;
    cachedFrame = null;
  }

  function signature(frame: number): string {
    return `${version}:${state.mode}:${state.context.query}:${state.context.matchedIds.length}:${state.context.selectedNodeId ?? ''}:${viewport.width}x${viewport.height}@${viewport.zoom}:${viewport.centerX},${viewport.centerY}:${tokens.background}:${tokens.motion}:${frame}`;
  }

  const api: UniverseEngine = {
    dispatch(action) {
      const next = reduceUniverseState(state, action);
      if (next === state) return;
      state = next;
      rebuildScene();
      options.onStateChange?.(state);
    },
    getState() {
      return state;
    },
    getTokens() {
      return tokens;
    },
    setTokens(input) {
      const merged = createTokens({
        palette: { ...tokens.palette, ...(input.palette ?? {}) },
        node: { ...tokens.node, ...(input.node ?? {}) },
        search: { ...tokens.search, ...(input.search ?? {}) },
        background: input.background ?? tokens.background,
        lineStyle: input.lineStyle ?? tokens.lineStyle,
        nodeStyle: input.nodeStyle ?? tokens.nodeStyle,
        motion: input.motion ?? tokens.motion,
        decisionPolicy: input.decisionPolicy ?? tokens.decisionPolicy,
      });
      if (merged.decisionPolicy === tokens.decisionPolicy) {
        tokens = merged;
        rebuildScene();
        return;
      }
      tokens = merged;
      rebuildFacts(Date.now());
      rebuildScene();
    },
    setGraph(nextNodes, nextEdges, nextToday) {
      nodes = Object.freeze([...nextNodes]) as readonly UniverseNodeInput[];
      edges = Object.freeze([...nextEdges]) as readonly UniverseEdgeInput[];
      today = new Map(indexTodayLearning(nextToday ?? []));
      index.rebuild(nodes);
      rebuildFacts(Date.now());
      rebuildScene();
    },
    setViewport(next) {
      if (!Number.isFinite(next.width) || !Number.isFinite(next.height) || next.width <= 0 || next.height <= 0) {
        throw new Error('UniverseEngine: viewport 宽高必须为正有限数');
      }
      viewport = Object.freeze({ ...next });
      rebuildScene();
    },
    hitTest(x, y, padding = 0) {
      return index.hitTest(x, y, padding);
    },
    buildFrame(frame = 0) {
      const sig = signature(frame);
      if (cachedFrame && cachedFrame.signature === sig) return cachedFrame.list;
      const list = buildDrawList(scene, viewport, tokens, frame);
      cachedFrame = Object.freeze({ signature: sig, list });
      return list;
    },
    render(ctx, frame = 0) {
      return paintDrawList(ctx, api.buildFrame(frame), tokens, frame);
    },
    getPendingChannels() {
      const first = facts.values().next();
      return first.done ? Object.freeze([]) as readonly ChannelId[] : first.value.pendingChannels;
    },
    getFacts(id) {
      return facts.get(id);
    },
    destroy() {
      index.clear();
      facts = new Map();
      today = new Map();
      nodes = Object.freeze([]) as readonly UniverseNodeInput[];
      edges = Object.freeze([]) as readonly UniverseEdgeInput[];
      scene = EMPTY_SCENE;
      cachedFrame = null;
      state = createInitialState();
    },
  };

  return Object.freeze(api);
}
