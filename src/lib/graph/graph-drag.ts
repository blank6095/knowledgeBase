/**
 * 节点拖拽物理参数与纯函数（拖拽流畅度/惯性改造的决策层）。
 *
 * 背景（改前行为的两处硬伤）：
 * 1. `onNodeDrag` 每次拖拽开始调用 `d3ReheatSimulation()`——把 alpha 拉满到 1，
 *    与 force-graph 内建的「拖拽期 alphaTarget(0.3) 低强度跟随」直接冲突：
 *    邻居被瞬间弹开、每帧 tick 全量 Barnes-Hut，大图拖拽帧率骤降（卡顿）。
 * 2. `pinInitial` 给全部节点设置 fx/fy 固定坐标——邻居完全不动，拖拽像在
 *    静态贴图上挪贴纸（僵硬）；松手再硬钉 fx/fy，没有惯性。
 *
 * 本模块只做决策与数值计算，不触碰 DOM / 引擎实例：
 * - dragModeFor：按规模选择拖拽模式。小图用「实时弹性」（引擎在拖拽期以
 *   alphaTarget≈0.3 低速运转，邻居被连线弹性带动）；大图 tick 成本超过帧预算
 *   （2000 节点 ≈10ms/tick），改为「冻结布局」——拖拽期 cooldownTicks(0) 让引擎
 *   每 frame 至多 tick 0 次（force-graph 每次指针移动会 resetCountdown，因此
 *   实际效果是「指针移动→重绘→不 tick」），松手再统一 reheat 收敛。
 * - recordDragSample / releaseVelocity：记录拖拽轨迹采样，松手时按最近时间窗
 *   估算指针速度并换算为节点初速度（d3 每 tick 位移 px），实现「甩出去」的
 *   惯性滑翔；速度限幅防止极端快甩把节点射出星系。
 */

export type DragMode = 'live' | 'frozen';

/** 实时弹性拖拽的规模上限：2000 节点 ≈ 10ms/tick，加上绘制仍可维持 ≥50fps */
export const LIVE_DRAG_MAX_NODES = 2_000;

/** 超过该规模时，拖拽期对力做临时减负（提高 Barnes-Hut theta、关闭碰撞） */
export const DRAG_LIGHTEN_MIN_NODES = 600;
/** 拖拽期 Barnes-Hut theta 增量：精度换速度，松手恢复 */
export const DRAG_THETA_BOOST = 0.35;

/**
 * 采样最小间隔（触发节流）：把指针事件率归一到 ~125Hz。
 *
 * d3-drag 对每个 pointermove 都派发 drag 事件：1000Hz 游戏鼠标 + 高刷屏下
 * 1ms 一条，触控板/普通鼠标 8–16ms 一条。旧实现每条都入样，32 条硬上限
 * 会把 120ms 速度窗口实际截断到 ~32ms——窗口只剩松手前的减速段，
 * 同一手势在不同轮询率设备上甩出的距离不一致（高频设备反而"更迟钝"）。
 * 按 8ms 抽稀后，窗口内样本数稳定在 ~15 条，与设备无关。
 */
export const SAMPLE_MIN_INTERVAL_MS = 8;
/** 惯性采样窗口：取松手前这段时长内的轨迹估算指针速度 */
export const RELEASE_WINDOW_MS = 120;
/** 采样保留时长：略大于窗口，保证窗口内仍有足够样本 */
export const SAMPLE_KEEP_MS = 240;
/** 采样条数硬上限：240ms / 8ms = 30 条，留约 1.6 倍余量应对异常时钟 */
const SAMPLE_MAX = 48;
/**
 * 指针速度（px/s）→ 节点初速度（px/tick）的换算增益。
 * 拖拽期节点与指针严格 1:1（force-graph 用 /k 折算回图坐标），因此 1.0 即
 * "松手后按松手前原速继续"；旧值 2.2 把惯性放大一倍多，节点冲过头再被簇锚点
 * 弹簧拽回，观感就是"太灵敏/发飘"。
 */
export const RELEASE_VELOCITY_GAIN = 1;
/** 初速度限幅（px/tick）：30px/tick ≈ 1800px/s，已快于任何有意的拖拽 */
export const RELEASE_MAX_SPEED = 30;
/** 最小有效采样跨度：慢速拖拽（近乎静止）不产生惯性 */
export const RELEASE_MIN_SPAN_MS = 24;
/**
 * 停稳判定：松手前这段时间内没有新轨迹，视为"已经停住再松手"。
 * 旧实现没有这道闸，拖到目标位置停顿 100ms 后松手，仍会把停顿前的速度
 * 重新甩出去——这是"灵敏度过度"最典型的触发场景。
 */
export const RELEASE_STALE_MS = 90;
/**
 * 触发惯性的最小屏幕速度（px/s）。
 * 低于该值属于手指微调/手抖，注入惯性只会让节点自己漂走，反而不受控。
 */
export const RELEASE_MIN_SCREEN_SPEED = 140;

/**
 * 滑翔窗口：释放后短暂降低阻尼（GLIDE_VELOCITY_DECAY），让惯性可见地滑行并平顺归位。
 * 说明：force-graph 的 alphaTarget 由库在拖拽期自管（0.3），React 层无法绑定
 * d3AlphaTarget prop（外层 kapsule 未暴露），收敛节奏交给 d3AlphaDecay 自然衰减。
 * 0.34 比默认 0.4 略松（滑翔约 3 帧可见），又比旧值 0.3 收得快，减少过冲。
 */
export const GLIDE_VELOCITY_DECAY = 0.34;
export const GLIDE_SETTLE_MS = 300;

/** 冻结拖拽（大图）释放后的收敛窗口：重热后留足邻居「追上」的时间，期间力保持减负 */
export const FROZEN_SETTLE_MS = 600;

export interface DragSample {
  /** performance.now() 时间戳 */
  t: number;
  x: number;
  y: number;
}

/**
 * 按节点规模选拖拽模式。
 * 非法输入（NaN/负数）按小图处理：空图/异常规模拖不到节点，模式无实际影响。
 */
export function dragModeFor(nodeCount: number): DragMode {
  if (Number.isNaN(nodeCount) || nodeCount <= LIVE_DRAG_MAX_NODES) return 'live';
  return 'frozen';
}

/**
 * 追加一条轨迹采样并剪除窗口外旧样本（原地修改，供 onNodeDrag 每次指针移动调用）。
 *
 * 触发间隔：距上一条不足 SAMPLE_MIN_INTERVAL_MS 的事件直接丢弃（返回 false），
 * 让采样频率与设备轮询率解耦；首次调用（空数组）总是记录，不会丢起步点。
 * 返回值表示是否真的入样，调用方据此判断是否需要重算速度。
 */
export function recordDragSample(samples: DragSample[], x: number, y: number, now: number): boolean {
  const last = samples[samples.length - 1];
  if (last && now - last.t < SAMPLE_MIN_INTERVAL_MS) return false;
  samples.push({ t: now, x, y });
  const cutoff = now - SAMPLE_KEEP_MS;
  let drop = 0;
  while (drop < samples.length && samples[drop].t < cutoff) drop += 1;
  if (drop > 0) samples.splice(0, drop);
  // 双保险：异常时钟（now 不单调）下数组也可能膨胀，硬上限截断
  if (samples.length > SAMPLE_MAX) samples.splice(0, samples.length - SAMPLE_MAX);
  return true;
}

/** 清空采样（拖拽开始/结束时调用，防止跨拖拽残留） */
export function resetDragSamples(samples: DragSample[]): void {
  samples.length = 0;
}

export interface ReleaseOptions {
  /** 指针速度 → 节点初速度的换算增益，默认 RELEASE_VELOCITY_GAIN */
  gain?: number;
  /** 初速度限幅（px/tick），默认 RELEASE_MAX_SPEED */
  maxSpeed?: number;
  /** 当前缩放（图坐标 → 屏幕像素倍率）：只用于最小屏幕速度判定，不改变返回值单位 */
  scale?: number;
}

/**
 * 估算释放初速度 { vx, vy }（图坐标 px/tick）。
 *
 * 三重闸门，任一不满足都返回零速度（= 松手即停，不做惯性投射）：
 * 1. 停稳闸：最后一条轨迹早于 RELEASE_STALE_MS → 用户已经停住，不应再飞出；
 * 2. 跨度闸：窗口内有效时间跨度 < RELEASE_MIN_SPAN_MS → 样本不足以判断方向；
 * 3. 速度闸：换算到屏幕后低于 RELEASE_MIN_SCREEN_SPEED → 属于微调/手抖。
 *
 * 用窗口内首末样本的位移/时间差求平均速度（比逐对差分更抗抖动）；
 * 换算：px/s ÷ 60fps × gain，最后按 maxSpeed 限幅。
 */
export function releaseVelocity(
  samples: readonly DragSample[],
  now: number,
  options: ReleaseOptions = {},
): { vx: number; vy: number } {
  const { gain = RELEASE_VELOCITY_GAIN, maxSpeed = RELEASE_MAX_SPEED, scale = 1 } = options;
  if (samples.length < 2) return { vx: 0, vy: 0 };

  const last = samples[samples.length - 1];
  // 1) 停稳闸：松手前已静止（拖动到位后停顿再松手）
  if (now - last.t > RELEASE_STALE_MS) return { vx: 0, vy: 0 };

  const cutoff = now - RELEASE_WINDOW_MS;
  let first = 0;
  while (first < samples.length && samples[first].t < cutoff) first += 1;
  if (first >= samples.length - 1) return { vx: 0, vy: 0 };

  const spanMs = last.t - samples[first].t;
  // 2) 跨度闸
  if (spanMs < RELEASE_MIN_SPAN_MS) return { vx: 0, vy: 0 };

  const dx = last.x - samples[first].x;
  const dy = last.y - samples[first].y;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // 3) 速度闸：图坐标速度 × 缩放 = 屏幕速度（手势快慢应由屏幕位移决定，与当前缩放无关）
  const screenSpeed = (Math.hypot(dx, dy) / spanMs) * 1000 * safeScale;
  if (!(screenSpeed >= RELEASE_MIN_SCREEN_SPEED)) return { vx: 0, vy: 0 };

  const pxPerMsToPxPerTick = (1000 / 60) * gain;
  const vx = (dx / spanMs) * pxPerMsToPxPerTick;
  const vy = (dy / spanMs) * pxPerMsToPxPerTick;
  const speed = Math.hypot(vx, vy);
  const clamp = speed > maxSpeed ? maxSpeed / speed : 1;
  return { vx: vx * clamp, vy: vy * clamp };
}
