/**
 * 学习地图标记（U4-3）纯逻辑。
 *
 * 四类标记（可叠加）：
 * - weak  薄弱：memory < 0.4（默认阈值，可配置）
 * - due   到期复习：`/api/learning/today` 中 reasonCode === 'due-review'
 * - today 今日推荐：其余今日学习条目
 * - hub   重要枢纽：关联度数 Top 10%（默认，minDegree 2）
 *
 * 只产出标记集合，不修改节点/关系；绘制层用独立的环/弧/断线通道表达，
 * 不覆盖记忆度颜色与节点大小。
 */
import type { GraphNode } from './graph-types';

export type MapMarkType = 'weak' | 'due' | 'today' | 'hub';

export interface MapMarkFlags {
  weak: boolean;
  due: boolean;
  today: boolean;
  hub: boolean;
}

export interface TodayLearningLite {
  segmentId: string;
  reasonCode: string;
}

export interface MapMarkOptions {
  weakThreshold?: number;
  hubTopRatio?: number;
  hubMinDegree?: number;
}

/** 标记对应的说明/颜色（UI 图例与 canvas 共用；颜色为独立视觉通道，不参与记忆度） */
export const MAP_MARK_META: Record<MapMarkType, { label: string; color: string; description: string }> = {
  weak: { label: '薄弱', color: '#e58a86', description: '记忆度 < 40%' },
  due: { label: '到期复习', color: '#e0b36a', description: '今天到期需复习' },
  today: { label: '今日推荐', color: '#5cc8e6', description: '今日学习推荐' },
  hub: { label: '重要枢纽', color: '#8fb0c8', description: '关联度数 Top 10%' },
};

export function emptyMarkFlags(): MapMarkFlags {
  return { weak: false, due: false, today: false, hub: false };
}

export function computeMapMarks(
  nodes: readonly GraphNode[],
  adjacency: Map<string, Set<string>>,
  todayItems: readonly TodayLearningLite[] = [],
  options: MapMarkOptions = {},
): Map<string, MapMarkFlags> {
  const weakThreshold = options.weakThreshold ?? 0.4;
  const hubTopRatio = options.hubTopRatio ?? 0.1;
  const hubMinDegree = options.hubMinDegree ?? 2;
  const marks = new Map<string, MapMarkFlags>();
  const ensure = (id: string): MapMarkFlags => {
    let flags = marks.get(id);
    if (!flags) {
      flags = emptyMarkFlags();
      marks.set(id, flags);
    }
    return flags;
  };

  for (const node of nodes) {
    if (typeof node.memory === 'number' && node.memory < weakThreshold) {
      ensure(node.id).weak = true;
    }
  }

  const dueIds = new Set<string>();
  for (const item of todayItems) {
    if (item.reasonCode === 'due-review') {
      dueIds.add(item.segmentId);
      ensure(item.segmentId).due = true;
    } else {
      ensure(item.segmentId).today = true;
    }
  }

  const degrees = nodes
    .map((node) => ({ id: node.id, degree: adjacency.get(node.id)?.size ?? 0 }))
    .filter((entry) => entry.degree >= hubMinDegree)
    .sort((a, b) => (b.degree === a.degree ? a.id.localeCompare(b.id) : b.degree - a.degree));
  const hubCount = Math.max(1, Math.ceil(degrees.length * hubTopRatio));
  for (const entry of degrees.slice(0, hubCount)) {
    ensure(entry.id).hub = true;
  }

  for (const id of marks.keys()) {
    if (!marks.get(id) || Object.values(marks.get(id)!).every((value) => !value)) {
      marks.delete(id);
    }
  }
  return marks;
}

/** 统计每类标记的节点数（图例/面板展示）。 */
export function countMapMarks(marks: Map<string, MapMarkFlags>): Record<MapMarkType, number> {
  const counts: Record<MapMarkType, number> = { weak: 0, due: 0, today: 0, hub: 0 };
  for (const flags of marks.values()) {
    for (const type of Object.keys(counts) as MapMarkType[]) {
      if (flags[type]) counts[type] += 1;
    }
  }
  return counts;
}
