/**
 * 图谱 UI 偏好持久化（U3-5 / UX-29）。
 *
 * 只存 UI 偏好（localStorage），不写业务表；任何异常都静默降级为默认值：
 * - localStorage 不可用（隐私模式/禁用）；
 * - JSON 损坏、版本不匹配、id 非法、数值越界。
 *
 * 两组独立的 key，互不影响：
 * - `kb.graph.preferences.v1`：外观（环境/节点风格/光晕/背景），U3-5 起已有；
 * - `kb.graph.view-preferences.v1`：视图（筛选/分组/显示/力），UX-29 新增。
 * 分组写入独立 key 是为了向后兼容：旧版本没有这个 key 时全部回默认值，
 * 已存在的外观偏好（旧 key）语义与测试都不受影响。
 */
import { MEMORY_TIER_ORDER } from '@/lib/memory';
import {
  DEFAULT_GRAPH_PREFERENCES,
  isGraphEnvironmentId,
  isGraphNodeStyleId,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
  type GraphPreferences,
} from './graph-theme';
import { createInitialVisualState, DEFAULT_FORCES, KINDS, type Forces, type GroupRule } from './graph-state';

export { DEFAULT_GRAPH_PREFERENCES } from './graph-theme';

export const GRAPH_PREFERENCES_KEY = 'kb.graph.preferences.v1';
export const GRAPH_PREFERENCES_VERSION = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function normalize(raw: unknown): GraphPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GRAPH_PREFERENCES };
  const candidate = raw as Record<string, unknown>;
  const environment: GraphEnvironmentId = isGraphEnvironmentId(candidate.environment)
    ? candidate.environment
    : DEFAULT_GRAPH_PREFERENCES.environment;
  const nodeStyle: GraphNodeStyleId = isGraphNodeStyleId(candidate.nodeStyle)
    ? candidate.nodeStyle
    : DEFAULT_GRAPH_PREFERENCES.nodeStyle;
  const glow =
    typeof candidate.glow === 'number' && Number.isFinite(candidate.glow)
      ? clamp(candidate.glow, 0.5, 1.8)
      : DEFAULT_GRAPH_PREFERENCES.glow;
  const background =
    typeof candidate.background === 'number' && Number.isFinite(candidate.background)
      ? clamp(candidate.background, 0.4, 1.5)
      : DEFAULT_GRAPH_PREFERENCES.background;
  return { version: GRAPH_PREFERENCES_VERSION, environment, nodeStyle, glow, background };
}

/** 解析原始 JSON 字符串；任何损坏/版本不符都回默认。 */
export function parseGraphPreferences(raw: string | null | undefined): GraphPreferences {
  if (!raw) return { ...DEFAULT_GRAPH_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_GRAPH_PREFERENCES };
    const record = parsed as Record<string, unknown>;
    if (record.version !== GRAPH_PREFERENCES_VERSION) return { ...DEFAULT_GRAPH_PREFERENCES };
    return normalize(record);
  } catch {
    return { ...DEFAULT_GRAPH_PREFERENCES };
  }
}

export function loadGraphPreferences(storage?: ReadableStorage | null): GraphPreferences {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return { ...DEFAULT_GRAPH_PREFERENCES };
    return parseGraphPreferences(target.getItem(GRAPH_PREFERENCES_KEY));
  } catch {
    return { ...DEFAULT_GRAPH_PREFERENCES };
  }
}

export function saveGraphPreferences(prefs: GraphPreferences, storage?: WritableStorage | null): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return;
    target.setItem(
      GRAPH_PREFERENCES_KEY,
      JSON.stringify({
        version: GRAPH_PREFERENCES_VERSION,
        environment: prefs.environment,
        nodeStyle: prefs.nodeStyle,
        glow: prefs.glow,
        background: prefs.background,
      }),
    );
  } catch {
    // 隐私模式/配额满：静默降级，不打断体验
  }
}

// ---------------------------------------------------------------------------
// 外部 store：供 useSyncExternalStore 使用，避免「在 effect 里 setState」，
// 并保证 SSR 使用默认快照、水合后再切到 localStorage 的真实偏好。
// ---------------------------------------------------------------------------
let snapshot: GraphPreferences | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getGraphPreferencesSnapshot(): GraphPreferences {
  snapshot ??= loadGraphPreferences();
  return snapshot;
}

export function getServerGraphPreferencesSnapshot(): GraphPreferences {
  // 必须返回稳定引用：useSyncExternalStore 会以引用相等判断是否需要重复渲染
  return DEFAULT_GRAPH_PREFERENCES;
}

export function subscribeGraphPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateGraphPreferences(patch: Partial<Omit<GraphPreferences, 'version'>>): GraphPreferences {
  const next = parseGraphPreferences(JSON.stringify({ ...getGraphPreferencesSnapshot(), ...patch, version: GRAPH_PREFERENCES_VERSION }));
  snapshot = next;
  saveGraphPreferences(next);
  emit();
  return next;
}

export function resetGraphPreferences(): GraphPreferences {
  snapshot = { ...DEFAULT_GRAPH_PREFERENCES };
  saveGraphPreferences(snapshot);
  emit();
  return snapshot;
}

// ---------------------------------------------------------------------------
// 视图偏好（UX-29）：筛选 / 分组 / 显示 / 力参数
//
// 与外观偏好分开存：旧版本没有视图 key 时整组回默认值（向后兼容），
// 外观偏好的 v1 语义与既有测试不受影响。SSR 下不访问 window。
// 「暂停动画」「搜索关键词」属于会话态，不写入（面板内有文案注明）。
// ---------------------------------------------------------------------------
export const GRAPH_VIEW_PREFERENCES_KEY = 'kb.graph.view-preferences.v1';
export const GRAPH_VIEW_PREFERENCES_VERSION = 1;

export interface GraphViewPreferences {
  version: 1;
  /** 记忆程度档 → 是否显示（缺省 true，对应「全部取消」前后的默认勾选） */
  tierOn: Record<string, boolean>;
  /** 关联类型 → 是否显示 */
  kindOn: Record<string, boolean>;
  /** 分组规则（关键词 + 颜色），最多保留 20 条 */
  groups: GroupRule[];
  arrows: boolean;
  fadeThreshold: number;
  sizeMult: number;
  linkWidthMult: number;
  forces: Forces;
}

/** 数值区间与 `graph-state` 的默认值/滑杆范围保持一致，防止脏数据把滑杆顶出界。 */
const VIEW_RANGES = {
  fadeThreshold: [0.5, 3],
  sizeMult: [0.5, 3],
  linkWidthMult: [0.5, 4],
} as const;

const FORCE_RANGES = {
  center: [0, 2],
  charge: [10, 300],
  linkStrength: [0.1, 1],
  linkDistance: [10, 200],
} as const;

const MAX_GROUPS = 20;
const GROUP_QUERY_MAX_LENGTH = 60;
const GROUP_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** 默认视图偏好：与 `createInitialVisualState()` 同源，避免两处默认值漂移。 */
export function createDefaultGraphViewPreferences(): GraphViewPreferences {
  const initial = createInitialVisualState();
  return {
    version: GRAPH_VIEW_PREFERENCES_VERSION,
    tierOn: initial.tierOn,
    kindOn: initial.kindOn,
    groups: [],
    arrows: initial.arrows,
    fadeThreshold: initial.fadeThreshold,
    sizeMult: initial.sizeMult,
    linkWidthMult: initial.linkWidthMult,
    forces: initial.forces,
  };
}

/** 稳定引用：`useSyncExternalStore` 的 getServerSnapshot 必须返回同一对象。 */
export const DEFAULT_GRAPH_VIEW_PREFERENCES: GraphViewPreferences = createDefaultGraphViewPreferences();

function normalizeBooleanMap(value: unknown, keys: readonly string[]): Record<string, boolean> {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const normalized: Record<string, boolean> = {};
  for (const key of keys) normalized[key] = typeof source[key] === 'boolean' ? source[key] : true;
  return normalized;
}

function pickRangeNumber(value: unknown, range: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, range[0], range[1]);
}

function normalizeGroups(value: unknown): GroupRule[] {
  if (!Array.isArray(value)) return [];
  const groups: GroupRule[] = [];
  const usedIds = new Set<number>();
  let nextId = 1;
  for (const item of value) {
    if (groups.length >= MAX_GROUPS) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    // 编辑中的分组允许关键词暂时为空（用户清空输入框重输），只校验类型；
    // 空关键词不会命中任何节点，不影响绘制（匹配时另做 trim）。
    const query =
      typeof record.query === 'string' ? record.query.slice(0, GROUP_QUERY_MAX_LENGTH) : null;
    if (query === null) continue;
    const color = typeof record.color === 'string' && GROUP_COLOR_PATTERN.test(record.color) ? record.color : '';
    if (!color) continue;
    const rawId = typeof record.id === 'number' && Number.isInteger(record.id) && record.id > 0 ? record.id : 0;
    let id = rawId > 0 && !usedIds.has(rawId) ? rawId : 0;
    while (id === 0) {
      while (usedIds.has(nextId)) nextId += 1;
      id = nextId;
      nextId += 1;
    }
    usedIds.add(id);
    groups.push({ id, query, color });
  }
  return groups;
}

function normalizeForces(value: unknown): Forces {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    center: pickRangeNumber(source.center, FORCE_RANGES.center, DEFAULT_FORCES.center),
    charge: pickRangeNumber(source.charge, FORCE_RANGES.charge, DEFAULT_FORCES.charge),
    linkStrength: pickRangeNumber(source.linkStrength, FORCE_RANGES.linkStrength, DEFAULT_FORCES.linkStrength),
    linkDistance: pickRangeNumber(source.linkDistance, FORCE_RANGES.linkDistance, DEFAULT_FORCES.linkDistance),
  };
}

/**
 * 归一化任意来源的视图偏好：缺字段回默认值（兼容旧数据），非法字段回默认，
 * 数值越界 clamp，分组逐条校验（关键词必须是字符串、颜色必须是 6 位 hex）。
 */
export function normalizeGraphViewPreferences(raw: unknown): GraphViewPreferences {
  const defaults = createDefaultGraphViewPreferences();
  const candidate =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    version: GRAPH_VIEW_PREFERENCES_VERSION,
    tierOn: normalizeBooleanMap(candidate.tierOn, MEMORY_TIER_ORDER),
    kindOn: normalizeBooleanMap(
      candidate.kindOn,
      KINDS.map((kind) => kind.kind),
    ),
    groups: normalizeGroups(candidate.groups),
    arrows: typeof candidate.arrows === 'boolean' ? candidate.arrows : defaults.arrows,
    fadeThreshold: pickRangeNumber(candidate.fadeThreshold, VIEW_RANGES.fadeThreshold, defaults.fadeThreshold),
    sizeMult: pickRangeNumber(candidate.sizeMult, VIEW_RANGES.sizeMult, defaults.sizeMult),
    linkWidthMult: pickRangeNumber(candidate.linkWidthMult, VIEW_RANGES.linkWidthMult, defaults.linkWidthMult),
    forces: normalizeForces(candidate.forces),
  };
}

/** 解析原始 JSON 字符串；损坏/版本不符整组回默认。 */
export function parseGraphViewPreferences(raw: string | null | undefined): GraphViewPreferences {
  if (!raw) return createDefaultGraphViewPreferences();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return createDefaultGraphViewPreferences();
    const record = parsed as Record<string, unknown>;
    if (record.version !== GRAPH_VIEW_PREFERENCES_VERSION) return createDefaultGraphViewPreferences();
    return normalizeGraphViewPreferences(record);
  } catch {
    return createDefaultGraphViewPreferences();
  }
}

export function loadGraphViewPreferences(storage?: ReadableStorage | null): GraphViewPreferences {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return createDefaultGraphViewPreferences();
    return parseGraphViewPreferences(target.getItem(GRAPH_VIEW_PREFERENCES_KEY));
  } catch {
    return createDefaultGraphViewPreferences();
  }
}

export function saveGraphViewPreferences(
  prefs: GraphViewPreferences,
  storage?: WritableStorage | null,
): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    if (!target) return;
    // 落盘前再归一化一次：调用方传部分字段时也不会把非法值写进 storage
    target.setItem(GRAPH_VIEW_PREFERENCES_KEY, JSON.stringify(normalizeGraphViewPreferences(prefs)));
  } catch {
    // 隐私模式/配额满：静默降级，不打断体验
  }
}

// ---------------------------------------------------------------------------
// 视图偏好外部 store（与外观偏好同样的 useSyncExternalStore 模式）：
// SSR 用默认快照、水合后切到 localStorage 真值，避免首帧水合不一致。
// ---------------------------------------------------------------------------
let viewSnapshot: GraphViewPreferences | null = null;
const viewListeners = new Set<() => void>();

function emitView(): void {
  for (const listener of viewListeners) listener();
}

export function getGraphViewPreferencesSnapshot(): GraphViewPreferences {
  viewSnapshot ??= loadGraphViewPreferences();
  return viewSnapshot;
}

export function getServerGraphViewPreferencesSnapshot(): GraphViewPreferences {
  return DEFAULT_GRAPH_VIEW_PREFERENCES;
}

export function subscribeGraphViewPreferences(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

export function updateGraphViewPreferences(
  patch: Partial<Omit<GraphViewPreferences, 'version'>>,
): GraphViewPreferences {
  const next = normalizeGraphViewPreferences({
    ...getGraphViewPreferencesSnapshot(),
    ...patch,
    version: GRAPH_VIEW_PREFERENCES_VERSION,
  });
  viewSnapshot = next;
  saveGraphViewPreferences(next);
  emitView();
  return next;
}

export function resetGraphViewPreferences(): GraphViewPreferences {
  viewSnapshot = createDefaultGraphViewPreferences();
  saveGraphViewPreferences(viewSnapshot);
  emitView();
  return viewSnapshot;
}
