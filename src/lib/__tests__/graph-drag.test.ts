import { describe, expect, it } from 'vitest';
import {
  RELEASE_MAX_SPEED,
  RELEASE_MIN_SCREEN_SPEED,
  RELEASE_STALE_MS,
  RELEASE_VELOCITY_GAIN,
  RELEASE_WINDOW_MS,
  SAMPLE_MIN_INTERVAL_MS,
  dragModeFor,
  recordDragSample,
  releaseVelocity,
  resetDragSamples,
} from '@/lib/graph/graph-drag';

describe('dragModeFor：按规模选拖拽模式', () => {
  it('小图/中等规模用实时弹性拖拽，超大图冻结布局保帧率', () => {
    expect(dragModeFor(0)).toBe('live');
    expect(dragModeFor(500)).toBe('live');
    expect(dragModeFor(2_000)).toBe('live');
    expect(dragModeFor(2_001)).toBe('frozen');
    expect(dragModeFor(20_000)).toBe('frozen');
  });

  it('非法输入按小图处理', () => {
    expect(dragModeFor(Number.NaN)).toBe('live');
    expect(dragModeFor(-1)).toBe('live');
    expect(dragModeFor(Number.POSITIVE_INFINITY)).toBe('frozen');
  });
});

describe('recordDragSample：采样节流与窗口剪除', () => {
  it('距上一条不足最小间隔的事件被丢弃（触发间隔与设备轮询率解耦）', () => {
    const samples: { t: number; x: number; y: number }[] = [];
    expect(recordDragSample(samples, 0, 0, 0)).toBe(true);
    // 1ms / 4ms / 7ms：高刷鼠标的连发事件全部丢弃
    expect(recordDragSample(samples, 1, 0, 1)).toBe(false);
    expect(recordDragSample(samples, 2, 0, 4)).toBe(false);
    expect(recordDragSample(samples, 3, 0, 7)).toBe(false);
    expect(samples).toHaveLength(1);
    // 达到间隔才入样
    expect(recordDragSample(samples, 4, 0, SAMPLE_MIN_INTERVAL_MS)).toBe(true);
    expect(samples).toHaveLength(2);
  });

  it('按时间窗口剪除旧样本，保留最近轨迹', () => {
    const samples: { t: number; x: number; y: number }[] = [];
    recordDragSample(samples, 0, 0, 0);
    recordDragSample(samples, 10, 0, 100);
    recordDragSample(samples, 20, 0, 500); // 前 300ms 内的样本全部过期
    expect(samples).toHaveLength(1);
    expect(samples[0]).toEqual({ t: 500, x: 20, y: 0 });
  });

  it('异常时钟（时间倒退）下数组也不会无界增长', () => {
    const samples: { t: number; x: number; y: number }[] = [];
    for (let i = 0; i < 200; i += 1) recordDragSample(samples, i, i, 10); // now 恒定
    expect(samples.length).toBeLessThanOrEqual(48);
  });

  it('resetDragSamples 清空数组', () => {
    const samples: { t: number; x: number; y: number }[] = [];
    recordDragSample(samples, 1, 2, 3);
    resetDragSamples(samples);
    expect(samples).toHaveLength(0);
  });
});

describe('releaseVelocity：惯性初速度', () => {
  it('样本不足或时间跨度过短（慢速拖拽）不产生惯性', () => {
    expect(releaseVelocity([], 1000)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ t: 990, x: 0, y: 0 }], 1000)).toEqual({ vx: 0, vy: 0 });
    // 10ms 内仅移动 1px：跨度小于最小值
    expect(releaseVelocity([{ t: 990, x: 0, y: 0 }, { t: 1000, x: 1, y: 0 }], 1000)).toEqual({ vx: 0, vy: 0 });
  });

  it('停稳闸：松手前已静止超过 RELEASE_STALE_MS 时不再飞出', () => {
    // 拖到目标位置后停顿 150ms 再松手：末条轨迹是 150ms 前
    const samples = [
      { t: 700, x: 0, y: 0 },
      { t: 800, x: 100, y: 0 },
      { t: 850, x: 200, y: 0 },
    ];
    expect(releaseVelocity(samples, 1000)).toEqual({ vx: 0, vy: 0 });
    // 停顿 50ms（仍在容忍窗口内）→ 正常投射
    expect(releaseVelocity(samples, 900).vx).toBeGreaterThan(0);
  });

  it('速度闸：屏幕速度低于阈值（手抖/微调）不产生惯性', () => {
    const slow = [
      { t: 900, x: 0, y: 0 },
      { t: 1000, x: 10, y: 0 }, // 100px/s
    ];
    // 需要 10px/100ms × 2 = 200px/s
    expect(RELEASE_MIN_SCREEN_SPEED).toBeGreaterThan(100);
    expect(releaseVelocity(slow, 1000)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity(slow, 1000, { scale: 2 }).vx).toBeGreaterThan(0);
  });

  it('缩放只影响速度闸，不改变投射速度的大小（图坐标单位一致）', () => {
    const samples = [
      { t: 900, x: 0, y: 0 },
      { t: 1000, x: 90, y: 0 },
    ];
    const at1 = releaseVelocity(samples, 1000, { scale: 1 });
    const at4 = releaseVelocity(samples, 1000, { scale: 4 });
    expect(at1.vx).toBeCloseTo(at4.vx, 10);
    expect(at1.vx).toBeCloseTo((90 / 100) * (1000 / 60) * RELEASE_VELOCITY_GAIN, 6);
  });

  it('窗口外旧样本不参与计算', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 50, x: 900, y: 0 }, // 远在 120ms 窗口之前
      { t: 950, x: 900, y: 0 },
      { t: 1000, x: 920, y: 0 }, // 窗口内 50ms 移动 20px = 400px/s
    ];
    const v = releaseVelocity(samples, 1000);
    expect(v.vx).toBeCloseTo((20 / 50) * (1000 / 60) * RELEASE_VELOCITY_GAIN, 6);
    expect(v.vy).toBe(0);
  });

  it('速度方向与拖拽方向一致，且随距离线性缩放（未触限幅区间）', () => {
    const mk = (dx: number) => [
      { t: 900, x: 0, y: 0 },
      { t: 1000, x: dx, y: 0 },
    ];
    const slow = releaseVelocity(mk(30), 1000);
    const fast = releaseVelocity(mk(90), 1000);
    expect(slow.vx).toBeGreaterThan(0);
    expect(fast.vx).toBeGreaterThan(slow.vx);
    expect(slow.vy).toBe(0);
    expect(fast.vx / slow.vx).toBeCloseTo(3, 5);
  });

  it('极端快甩被限幅，不会把节点射出星系', () => {
    const samples = [
      { t: 900, x: 0, y: 0 },
      { t: 1000, x: 0, y: 5_000 },
    ];
    const v = releaseVelocity(samples, 1000);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(RELEASE_MAX_SPEED, 5);
  });

  it('全部样本都落在窗口之外时返回零速度', () => {
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 50, x: 500, y: 500 },
    ];
    expect(releaseVelocity(samples, 1000)).toEqual({ vx: 0, vy: 0 });
  });

  it('窗口宽度与采样间隔取自常量（防止实现漂移）', () => {
    expect(RELEASE_WINDOW_MS).toBe(120);
    expect(SAMPLE_MIN_INTERVAL_MS).toBe(8);
    expect(RELEASE_STALE_MS).toBe(90);
  });
});
