/**
 * 两层状态机：五种主交互模式互斥，五项独立上下文并存。
 *
 * 对应执行版任务清单 T05 / T14 / §6 表 6：
 * 六种产品状态名称保留，但「节点选中」降为独立上下文，
 * 不实现为一个互斥的状态枚举——切换主模式不得清空搜索词、选中节点、
 * 路径端点、浮层状态与离开前视角。
 *
 * 纯函数 reducer：相同输入产生相同输出；无变化返回原引用，便于跳过重绘。
 */

export type MainMode = 'explore' | 'search' | 'path' | 'learning' | 'ai';

export const MAIN_MODES: readonly MainMode[] = Object.freeze([
  'explore',
  'search',
  'path',
  'learning',
  'ai',
]);

export type OverlayId = 'none' | 'detail' | 'ai' | 'theme';

export interface ViewportSnapshot {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface UniverseContext {
  /** 独立上下文：当前选中节点 */
  readonly selectedNodeId: string | null;
  /** 独立上下文：当前搜索词与结果 */
  readonly query: string;
  readonly matchedIds: readonly string[];
  /** 独立上下文：路径起点与终点 */
  readonly pathEndpoints: readonly [string, string] | null;
  /** 独立上下文：浮层展开状态 */
  readonly overlay: OverlayId;
  /** 独立上下文：离开前的图谱位置 */
  readonly savedViewport: ViewportSnapshot | null;
}

export interface UniverseState {
  readonly mode: MainMode;
  readonly previousMode: MainMode | null;
  readonly context: UniverseContext;
}

export type UniverseAction =
  | { readonly type: 'enter-mode'; readonly mode: MainMode; readonly viewport?: ViewportSnapshot }
  | { readonly type: 'exit-mode' }
  | { readonly type: 'set-query'; readonly query: string; readonly matchedIds: readonly string[] }
  | { readonly type: 'clear-query' }
  | { readonly type: 'select-node'; readonly id: string }
  | { readonly type: 'clear-selection' }
  | { readonly type: 'set-path'; readonly from: string; readonly to: string }
  | { readonly type: 'clear-path' }
  | { readonly type: 'set-overlay'; readonly overlay: OverlayId }
  | { readonly type: 'save-viewport'; readonly viewport: ViewportSnapshot }
  | { readonly type: 'reset' };

export function createInitialState(): UniverseState {
  return Object.freeze({
    mode: 'explore' as MainMode,
    previousMode: null,
    context: Object.freeze({
      selectedNodeId: null,
      query: '',
      matchedIds: Object.freeze([]) as readonly string[],
      pathEndpoints: null,
      overlay: 'none' as OverlayId,
      savedViewport: null,
    }),
  });
}

function withContext(state: UniverseState, patch: Partial<UniverseContext>): UniverseState {
  return Object.freeze({
    ...state,
    context: Object.freeze({ ...state.context, ...patch }),
  });
}

function withMode(
  state: UniverseState,
  mode: MainMode,
  patch: Partial<UniverseContext> = {},
): UniverseState {
  if (state.mode === mode && Object.keys(patch).length === 0) return state;
  return Object.freeze({
    mode,
    previousMode: state.mode === mode ? state.previousMode : state.mode,
    context: Object.freeze({ ...state.context, ...patch }),
  });
}

/** 进入学习 / AI 模式前保存视角，返回时可还原；不覆盖已有快照。 */
function preserveViewport(state: UniverseState, mode: MainMode, viewport?: ViewportSnapshot) {
  if (mode !== 'learning' && mode !== 'ai') return {};
  if (state.context.savedViewport || !viewport) return {};
  return { savedViewport: Object.freeze({ ...viewport }) } satisfies Partial<UniverseContext>;
}

export function reduceUniverseState(state: UniverseState, action: UniverseAction): UniverseState {
  switch (action.type) {
    case 'enter-mode': {
      if (!MAIN_MODES.includes(action.mode)) return state;
      if (state.mode === action.mode) return state;
      return withMode(state, action.mode, preserveViewport(state, action.mode, action.viewport));
    }
    case 'exit-mode': {
      const target = state.previousMode ?? 'explore';
      const overlay: OverlayId = state.context.overlay === 'ai' || state.context.overlay === 'detail'
        ? 'none'
        : state.context.overlay;
      return withMode(state, target, { overlay });
    }
    case 'set-query': {
      const query = action.query.trim();
      const matchedIds = Object.freeze([...action.matchedIds]);
      if (query.length === 0) return reduceUniverseState(state, { type: 'clear-query' });
      return withMode(state, 'search', { query, matchedIds });
    }
    case 'clear-query': {
      if (state.context.query === '' && state.context.matchedIds.length === 0 && state.mode !== 'search') {
        return state;
      }
      const target = state.mode === 'search' ? (state.previousMode ?? 'explore') : state.mode;
      return withMode(state, target, { query: '', matchedIds: Object.freeze([]) as readonly string[] });
    }
    case 'select-node': {
      if (state.context.selectedNodeId === action.id && state.context.overlay === 'detail') return state;
      // 关键：只更新独立上下文，不改变主模式。
      return withContext(state, { selectedNodeId: action.id, overlay: 'detail' });
    }
    case 'clear-selection': {
      if (state.context.selectedNodeId === null && state.context.overlay === 'none') return state;
      return withContext(state, { selectedNodeId: null, overlay: 'none' });
    }
    case 'set-path': {
      const endpoints = Object.freeze([action.from, action.to]) as readonly [string, string];
      return withMode(state, 'path', { pathEndpoints: endpoints });
    }
    case 'clear-path': {
      if (state.context.pathEndpoints === null) return state;
      return withContext(state, { pathEndpoints: null });
    }
    case 'set-overlay': {
      if (state.context.overlay === action.overlay) return state;
      return withContext(state, { overlay: action.overlay });
    }
    case 'save-viewport': {
      return withContext(state, { savedViewport: Object.freeze({ ...action.viewport }) });
    }
    case 'reset':
      return createInitialState();
    default:
      return state;
  }
}

/** 供评审 / 验收核对该状态是否为合法主模式与完整上下文。 */
export function isConsistentState(state: UniverseState): boolean {
  if (!MAIN_MODES.includes(state.mode)) return false;
  if (state.mode === 'search' && state.context.query.length === 0) return false;
  if (state.mode === 'path' && state.context.pathEndpoints === null) return false;
  return true;
}
