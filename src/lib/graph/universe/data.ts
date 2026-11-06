/**
 * 数据来源适配层：把现有接口的字段映射为可渲染的「视觉事实」。
 *
 * 对应执行版任务清单 T01 / §5 表 4：
 * - `/api/graph` 节点只有 memory / viewCount / readingMs 等字段，
 *   没有掌握证据、没有待复习标记；
 * - 真实学习行为证据只经 `/api/learning/today` 的 latestResult /
 *   reasonCode / nextReviewAt 暴露，且仅覆盖今日推荐条目。
 *
 * 因此本模块严禁用 viewCount / readingMs / memory 推断「掌握」，
 * 也严禁用记忆亮度猜测「待复习」。DEC-01 未决时两个通道返回 null（第三态），
 * 既不提前保留也不提前移除。
 */

import type { ChannelId, DecisionChannelPolicy } from './tokens';
import { decisionGatedChannels } from './tokens';

export interface GraphNodeRecord {
  readonly id: string;
  readonly title: string;
  readonly memory: number;
  readonly viewCount: number;
  readonly readingMs: number;
  readonly documentTitle: string | null;
  readonly tags?: readonly string[];
  readonly summary?: string | null;
  readonly headingPath?: string;
}

export type LearningReasonCode =
  | 'previous-incorrect'
  | 'due-review'
  | 'continue-learning'
  | 'new-knowledge'
  | 'scheduled';

export type RecallResult = 'incorrect' | 'partial' | 'correct';

export interface TodayLearningRecord {
  readonly segmentId: string;
  readonly reasonCode: LearningReasonCode;
  readonly latestResult: RecallResult | null;
  readonly nextReviewAt: string | null;
}

export interface NodeFacts {
  readonly id: string;
  readonly title: string;
  /** 归一化后的记忆新鲜度，唯一允许驱动节点亮度的输入 */
  readonly memory: number;
  /** DEC-01 通道：null=待评审，true/false=评审后结论 */
  readonly masteryEvidence: boolean | null;
  readonly dueMarker: boolean | null;
  /** 待评审通道清单，供 T02 评审与验收查询 */
  readonly pendingChannels: readonly ChannelId[];
}

const DUE_REASONS: readonly LearningReasonCode[] = Object.freeze([
  'previous-incorrect',
  'due-review',
]);

/** 防御性归一化：NaN / 越界 / 负值时回落，保证渲染确定性。 */
export function normalizeMemory(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isDue(item: TodayLearningRecord, now: number): boolean {
  if (DUE_REASONS.includes(item.reasonCode)) return true;
  if (!item.nextReviewAt) return false;
  const ts = Date.parse(item.nextReviewAt);
  return Number.isFinite(ts) && ts <= now;
}

function hasRealLearningRecord(item: TodayLearningRecord): boolean {
  return item.latestResult !== null;
}

/**
 * 构造视觉事实。`policy` 必须由 T02 评审结论注入；默认 'pending'。
 * 只读输入、不修改入参、不访问网络、不读取数据库。
 */
export function createVisualFacts(
  node: GraphNodeRecord,
  today: TodayLearningRecord | undefined,
  policy: DecisionChannelPolicy,
  now: number = Date.now(),
): NodeFacts {
  const gated = decisionGatedChannels();

  if (policy === 'pending') {
    return Object.freeze({
      id: node.id,
      title: node.title,
      memory: normalizeMemory(node.memory),
      masteryEvidence: null,
      dueMarker: null,
      pendingChannels: Object.freeze([...gated]),
    });
  }

  if (policy === 'remove') {
    return Object.freeze({
      id: node.id,
      title: node.title,
      memory: normalizeMemory(node.memory),
      masteryEvidence: false,
      dueMarker: false,
      pendingChannels: Object.freeze([]) as readonly ChannelId[],
    });
  }

  return Object.freeze({
    id: node.id,
    title: node.title,
    memory: normalizeMemory(node.memory),
    // 只有真实复习记录才构成证据；「读过」不等同「掌握」。
    masteryEvidence: today ? hasRealLearningRecord(today) : false,
    dueMarker: today ? isDue(today, now) : false,
    pendingChannels: Object.freeze([]) as readonly ChannelId[],
  });
}

/** 把今日学习数组折叠成按 segmentId 查询的只读索引，避免渲染期线性查找。 */
export function indexTodayLearning(
  rows: readonly TodayLearningRecord[],
): ReadonlyMap<string, TodayLearningRecord> {
  const map = new Map<string, TodayLearningRecord>();
  for (const row of rows) {
    if (!row || typeof row.segmentId !== 'string') continue;
    map.set(row.segmentId, row);
  }
  return map;
}
