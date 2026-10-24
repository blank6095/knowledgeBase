/** 复习评分：0 忘记 / 1 困难 / 2 良好 / 3 简单 */
export type Grade = 0 | 1 | 2 | 3;

export interface Sm2State {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
}

export interface Sm2Result extends Sm2State {
  dueAt: Date;
  mastery: number;
  status: SegmentStatus;
}

export type SegmentStatus = 'new' | 'learning' | 'familiar' | 'mastered';

export const STATUS_LABEL: Record<SegmentStatus, string> = {
  new: '未学习',
  learning: '学习中',
  familiar: '较熟悉',
  mastered: '已掌握',
};

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const MAX_INTERVAL = 365;
const MASTERED_INTERVAL = 21; // 间隔达 3 周视为长期能记住

/**
 * Anki 风格的 SM-2 简化实现（天粒度）。
 * 忘记：记忆归零，10 分钟后重新出现；困难/良好/简单按 ease 与当前间隔扩展。
 */
export function review(state: Sm2State, grade: Grade, now = new Date()): Sm2Result {
  let { ease, intervalDays, reps, lapses } = state;

  if (grade === 0) {
    ease = clamp(ease - 0.2, MIN_EASE, MAX_EASE);
    lapses += 1;
    reps = 0;
    intervalDays = 0;
  } else if (grade === 1) {
    ease = clamp(ease - 0.15, MIN_EASE, MAX_EASE);
    reps += 1;
    intervalDays = reps === 1 ? 1 : Math.max(1, Math.round(intervalDays * 1.2));
  } else if (grade === 2) {
    reps += 1;
    intervalDays = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(intervalDays * ease);
  } else {
    ease = clamp(ease + 0.15, MIN_EASE, MAX_EASE);
    reps += 1;
    intervalDays = reps === 1 ? 3 : Math.round(intervalDays * ease * 1.3);
  }

  intervalDays = Math.min(intervalDays, MAX_INTERVAL);
  const dueAt =
    grade === 0
      ? new Date(now.getTime() + 10 * 60 * 1000) // 10 分钟后重现
      : new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return { ease, intervalDays, reps, lapses, dueAt, ...derive(state, grade) };
}

/** 从 SM-2 状态派生掌握度（0~1）与状态标签 */
export function derive(state: Sm2State, lastGrade?: number | null): { mastery: number; status: SegmentStatus } {
  if (state.reps === 0) return { mastery: 0, status: 'new' };
  const maturity = Math.min(1, state.intervalDays / MASTERED_INTERVAL);
  const easeScore = clamp((state.ease - MIN_EASE) / (MAX_EASE - MIN_EASE), 0, 1);
  let mastery = 0.75 * maturity + 0.25 * easeScore;
  if (state.lapses > 0) mastery *= Math.max(0.4, 1 - 0.1 * state.lapses);
  mastery = round2(clamp(mastery, 0, 1));

  const status: SegmentStatus =
    state.intervalDays >= MASTERED_INTERVAL && state.lapses === 0
      ? 'mastered'
      : state.intervalDays >= 7
        ? 'familiar'
        : 'learning';
  void lastGrade;
  return { mastery, status };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
