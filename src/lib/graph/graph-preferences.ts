/**
 * 图谱 UI 偏好持久化（U3-5）。
 *
 * 只存 UI 偏好（localStorage），不写业务表；任何异常都静默降级为默认值：
 * - localStorage 不可用（隐私模式/禁用）；
 * - JSON 损坏、版本不匹配、id 非法、数值越界。
 */
import {
  DEFAULT_GRAPH_PREFERENCES,
  isGraphEnvironmentId,
  isGraphNodeStyleId,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
  type GraphPreferences,
} from './graph-theme';

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
