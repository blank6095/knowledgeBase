/**
 * 基于阅读行为的记忆曲线模型（SM-2 的替代）。
 *
 * 记忆度 M(t) = exp(-Δt / S)：Δt 为距最近一次有效阅读的天数，S 为稳定度（天）。
 * 每次有效阅读（≥ MIN_EVENT_MS）推进稳定度，间隔越远增幅越大（间隔效应，有封顶），
 * 阅读时长决定当次推进的权重 w（3 分钟全效，防挂机封顶 10 分钟）。
 * memory 由 API 读取时现算，不落库；落库的只有 stability / readingMs / 阅读事件流水。
 */

/** 模型参数集中表：调参只改这里 */
export const MEMORY = {
  /** 首次阅读的基础稳定度（天） */
  FIRST_READ_BASE: 0.3,
  /** 首次阅读的稳定度加成（× 时长权重 w） */
  FIRST_READ_GAIN: 0.5,
  /** 间隔效应封顶：Δt_prev/S_prev 超过该倍数后不再增加增幅 */
  INTERVAL_EFFECT_CAP: 1.6,
  /** 稳定度上限（天） */
  STABILITY_CAP_DAYS: 365,
  /** 时长权重满分：单次阅读达到该分钟数 w=1 */
  FULL_WEIGHT_MINUTES: 3,
  /** 时长权重下限（很快划过也给保底权重） */
  MIN_WEIGHT: 0.2,
  /** 时长权重上限 */
  MAX_WEIGHT: 1,
  /** 单次有效时长上限（毫秒，防挂机） */
  MAX_SESSION_MS: 10 * 60_000,
  /** 有效阅读门槛：低于该时长的打开只计 viewCount，不写事件、不推进稳定度 */
  MIN_EVENT_MS: 5_000,
} as const;

const MS_PER_DAY = 86_400_000;

/** 展示档位：仅前端聚合，不落库 */
export type MemoryTier = 'unread' | 'weak' | 'medium' | 'strong';

export const TIER_THRESHOLDS = { strong: 0.75, medium: 0.4 } as const;

export const MEMORY_TIER_ORDER: MemoryTier[] = ['unread', 'weak', 'medium', 'strong'];

export function memoryTier(memory: number): MemoryTier {
  if (memory <= 0) return 'unread';
  if (memory < TIER_THRESHOLDS.medium) return 'weak';
  if (memory < TIER_THRESHOLDS.strong) return 'medium';
  return 'strong';
}

/**
 * 时长权重 w = clamp(有效时长 / FULL_WEIGHT_MINUTES, MIN_WEIGHT, MAX_WEIGHT)，
 * 有效时长先按 MAX_SESSION_MS 截断。
 */
export function readingWeight(durationMs: number): number {
  const effective = Math.min(Math.max(durationMs, 0), MEMORY.MAX_SESSION_MS);
  const w = effective / (MEMORY.FULL_WEIGHT_MINUTES * 60_000);
  return Math.min(MEMORY.MAX_WEIGHT, Math.max(MEMORY.MIN_WEIGHT, w));
}

/**
 * 一次阅读事件对稳定度的推进。
 * 返回新稳定度；durationMs 低于有效门槛时返回 null（调用方不写事件、不更新状态）。
 */
export function applyReading(
  prev: { stability: number; lastReadAt: Date | string | null },
  durationMs: number,
  now: Date,
): number | null {
  if (durationMs < MEMORY.MIN_EVENT_MS) return null;
  const w = readingWeight(durationMs);

  if (!prev.lastReadAt || prev.stability <= 0) {
    return round4(
      Math.min(MEMORY.STABILITY_CAP_DAYS, MEMORY.FIRST_READ_BASE + MEMORY.FIRST_READ_GAIN * w),
    );
  }

  const last = typeof prev.lastReadAt === 'string' ? new Date(prev.lastReadAt) : prev.lastReadAt;
  const gapDays = Math.max(0, (now.getTime() - last.getTime()) / MS_PER_DAY);
  const growth = Math.min(MEMORY.INTERVAL_EFFECT_CAP, gapDays / prev.stability);
  const next = prev.stability * (1 + w * growth) + MEMORY.FIRST_READ_GAIN * w;
  return round4(Math.min(MEMORY.STABILITY_CAP_DAYS, next));
}

/** 当前记忆度：从未有效阅读过（无 lastReadAt 或 stability=0）为 0，否则指数衰减 */
export function memoryOf(
  stability: number,
  lastReadAt: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  if (!lastReadAt || stability <= 0) return 0;
  const last = typeof lastReadAt === 'string' ? new Date(lastReadAt) : lastReadAt;
  const days = Math.max(0, (now.getTime() - last.getTime()) / MS_PER_DAY);
  return round4(Math.exp(-days / stability));
}

/** 半衰期：S × ln2 天，即「预计这么多天后忘一半」 */
export function halfLifeDays(stability: number): number {
  return stability * Math.LN2;
}

/**
 * 记忆度 → 图谱节点颜色（深底）。
 * 未读灰色；已读在紫色系（accent #8b6cef 家族，hue 254）内按 M 单调变亮：
 * lightness 约 30%→68%、saturation 约 40%→75%，亮度即记忆度。
 */
export function memoryColor(memory: number): string {
  const m = Math.min(1, Math.max(0, memory));
  if (m <= 0) return '#4b5563';
  const saturation = Math.round(40 + 35 * m);
  const lightness = Math.round((30 + 38 * m) * 10) / 10;
  return `hsl(254, ${saturation}%, ${lightness}%)`;
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
