import { describe, expect, it } from 'vitest';
import { derive, review, touch, type Sm2State } from '../sm2';

const fresh: Sm2State = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

describe('SM-2 复习算法', () => {
  it('新知识点首次评「良好」→ 1 天后复习', () => {
    const r = review(fresh, 2);
    expect(r.intervalDays).toBe(1);
    expect(r.reps).toBe(1);
    expect(r.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('连续「良好」按 ease 扩大间隔：1 → 3 → 7~8 天', () => {
    const r1 = review(fresh, 2);
    const r2 = review(r1, 2);
    const r3 = review(r2, 2);
    expect(r2.intervalDays).toBe(3);
    expect(r3.intervalDays).toBeGreaterThanOrEqual(7);
    expect(r3.intervalDays).toBeLessThanOrEqual(8);
  });

  it('评「忘记」清零 reps、记一次遗忘、10 分钟后重现', () => {
    const learned = review(review(fresh, 2), 2);
    const r = review(learned, 0);
    expect(r.reps).toBe(0);
    expect(r.lapses).toBe(1);
    expect(r.intervalDays).toBe(0);
    expect(r.dueAt.getTime() - Date.now()).toBeLessThan(15 * 60 * 1000);
    expect(r.ease).toBeCloseTo(2.3);
  });

  it('「简单」提升 ease，「困难」降低 ease，且有上下限', () => {
    const easy = review(fresh, 3);
    expect(easy.ease).toBeCloseTo(2.65);
    const hard = review(fresh, 1);
    expect(hard.ease).toBeCloseTo(2.35);

    let s = fresh;
    for (let i = 0; i < 20; i++) s = review(s, 1);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
    s = fresh;
    for (let i = 0; i < 20; i++) s = review(s, 3);
    expect(s.ease).toBeLessThanOrEqual(2.8);
  });

  it('掌握度随间隔增长，状态从未学习到已掌握', () => {
    expect(derive(fresh).status).toBe('new');
    expect(derive(fresh).mastery).toBe(0);

    const few = review(fresh, 2);
    expect(derive(few).status).toBe('learning');

    // 连续良好推进到 21 天以上 → 已掌握
    let s = fresh;
    for (let i = 0; i < 6; i++) s = review(s, 2);
    expect(s.intervalDays).toBeGreaterThanOrEqual(21);
    const d = derive(s);
    expect(d.status).toBe('mastered');
    expect(d.mastery).toBeGreaterThan(0.7);

    // 遗忘后状态回落
    const lapsed = review(s, 0);
    expect(derive(lapsed).status).toBe('new');
  });

  it('间隔不超过一年', () => {
    let s = fresh;
    for (let i = 0; i < 30; i++) s = review(s, 3);
    expect(s.intervalDays).toBeLessThanOrEqual(365);
  });
});

describe('touch（打开即学习）', () => {
  it('首次打开（无 lastViewedAt）按 grade=2 推进', () => {
    const r = touch(fresh, null, new Date('2026-10-25T10:00:00'));
    expect(r).not.toBeNull();
    expect(r!.reps).toBe(1);
    expect(r!.intervalDays).toBe(1);
    expect(r!.status).toBe('learning');
  });

  it('同日重复打开返回 null，不推进', () => {
    const learned: Sm2State = { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0 };
    const r = touch(learned, new Date('2026-10-25T08:00:00'), new Date('2026-10-25T22:00:00'));
    expect(r).toBeNull();
  });

  it('跨天首次打开推进（等价 grade=2 语义）并接受字符串日期', () => {
    const learned: Sm2State = { ease: 2.5, intervalDays: 1, reps: 1, lapses: 0 };
    const r = touch(learned, '2026-10-25T23:59:00', new Date('2026-10-26T09:00:00'));
    expect(r).not.toBeNull();
    expect(r!.reps).toBe(2);
    expect(r!.intervalDays).toBe(3);
  });
});
