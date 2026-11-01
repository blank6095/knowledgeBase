# 关系图谱丝滑度优化方案（含压测数据体系）

> **计划状态**：本文为专项计划/交付记录，任务状态与开放项以 [未完成任务清单](../未完成任务清单.md) 为准；文中路径相对仓库根书写。

> 诊断基于当前实现：`react-force-graph-2d`（Canvas 2D 渲染，d3-force-3d 布局引擎**已在 Web Worker 中运行**）、数据源 `/api/graph` 全量接口、过滤在客户端重算。压测工具链已落地：`scripts/gen-graph-data.mjs` + `/graph?fixture=<name>`。

## 1. 性能根因假设（按影响概率排序）

| 排序 | 根因 | 判断依据 | 验证方式 |
|---|---|---|---|
| 1 | 每帧访问器重复计算与字符串分配：`nodeColor` 每节点每帧构造 `hsl()` 字符串、`linkColor` 每边每帧 `KINDS.find()` 扫描（graph/page.tsx） | force-graph 每帧对每个对象调用访问器；20k 节点 60fps ≈ 120 万次/秒调用与等量字符串分配，GC 压力直接掉帧 | Performance 面板录 10s 拖拽，看访问器匿名函数 self time 与 Minor GC 频次；预计算后帧率 A/B |
| 2 | Canvas 2D 单画布全量重绘：每 tick/交互帧重绘全部节点与边，无分层、无脏区、无视口剔除 | react-force-graph-2d 默认渲染路径即如此；>5k 节点后 draw call 数成为 Paint 瓶颈 | 看面板中 Paint/Rasterize 占比是否随节点数超线性上涨；500/5k/20k 三档帧率斜率对比 |
| 3 | 数据层全量加载：`/api/graph` 无分页返回全部 segments+links，每节点携带 tags 数组等冗余字段 | 20k 节点实测 JSON ≈ 7.75MB（fixture 实测，约 390B/节点），传输+JSON.parse 阻塞主线程数百 ms | Network 面板 transfer 尺寸与 resource timing；performance 用户计时 JSON.parse 耗时；Long Task 条目 |
| 4 | 布局收敛控制不足：无 warmup、坐标不持久化；每次切换过滤 `graphData` 引用重建 → 模拟重启、坐标丢失全屏重排 | graph/page.tsx 过滤 useMemo 每次生成新数组；force-graph 收到新 graphData 即重置引擎 | onEngineStop 打点收敛时长；切换过滤后统计节点平均位移 |
| 5 | 交互层逐帧联动：nodeLabel 每次悬停重建 tooltip innerHTML；过滤面板任何 change 触发全量 useMemo 重算与整树重渲染 | nodeLabel 返回新模板串；过滤 checkbox 无防抖 | React Profiler 看 hover/过滤时 render 次数与耗时；Forced reflow 警告 |

## 2. 分层优化方案

| 层面 | 优化手段（改什么/怎么改） | 实现成本 | 预期收益 | 适用条件 | 验证指标 |
|---|---|---|---|---|---|
| 渲染层 | **R1 渲染属性预计算**：useMemo 中一次性算好每节点颜色串/半径、每边颜色/宽度挂到对象上，访问器只读字段 | 低 | 高（所有规模帧率地板抬升） | 立即，无前提 | 拖拽 fps、Minor GC 次数 |
| 渲染层 | **R2 视口裁剪+同色批量绘制**：自定义 nodeCanvasObject，按相机 transform 求视口 AABB，视口外早退；同色节点合并一次 fill | 中 | 高（大图缩放交互） | >8k 节点或深缩放掉帧时启用 | 深缩放局部 fps、每帧 draw call 数 |
| 渲染层 | **R3 位图缓存分层**：onEngineStop 后把静止图绘入离屏 canvas，交互帧 drawImage+高亮层 | 中 | 中高（收敛后交互） | 收敛后 hover/拖动仍全量重绘；需自包双 canvas 容器 | hover 单帧耗时 |
| 渲染层 | **R4 WebGL 迁移**（sigma.js 或 regl 自绘） | 高 | 高（>20k） | **前提**：R1/R2+计算层做完后 20k 压测仍 <30fps 才立项；不得跳过前置直接迁移 | 同 fixture A/B 帧率与内存 |
| 计算层 | **C1 布局参数调优**：warmupTicks 预热后再首帧渲染、d3VelocityDecay 0.4→0.3 减振荡、cooldownTime 收紧 | 低 | 中高（收敛时间约减半、消除开屏爆炸） | 立即 | onEngineStop 时长、前 3s 位移曲线 |
| 计算层 | **C2 Barnes-Hut theta 与电荷自适应**：manyBody 默认已用 Barnes-Hut(theta 0.9)，按规模调 theta(1.2 提速) 与 charge.strength | 低 | 中（>5k） | 节点 >5k 时 | 不同 theta 的收敛时长与边长方差 |
| 计算层 | **C3 坐标持久化+低温度重热**：engineStop 存坐标 Map；过滤/刷新时注入为初始坐标、alpha 低值 reheat 而非重启 | 中 | 高（过滤切换不重排） | 立即 | 切过滤后节点平均位移 <50px |
| 计算层 | **C4 WASM 布局引擎**（forceatlas2-wasm）替换 d3-force | 高 | 高 | 前提：C1–C3 后 20k 收敛仍 >20s；【待确认：是否接受引入 wasm 依赖】 | 收敛时长 A/B |
| 数据层 | **D1 接口瘦身**：/api/graph 输出去掉 tags/dueAt/documentId 等图谱冗余字段（tooltip 保留 documentTitle），gzip 已默认 | 低 | 中（传输/解析约 -40%） | 立即 | transfer 尺寸、parse 用户计时 |
| 数据层 | **D2 社区聚合按需展开**：>阈值时按社区折叠为超节点+聚合边权，zoom in 展开；减少进入渲染管线对象数 | 中高 | 高（50k 可用性） | 大规模真实数据或 50k 压测 | 50k 首帧、fps |
| 数据层 | **D3 前端 quadtree 空间索引**（d3-quadtree）：坐标索引用于视口查询与 O(1) 悬停命中 | 低 | 中 | 与 R2 配套 | hover 命中耗时、CPU |
| 交互层 | **I1 tooltip 缓存+过滤防抖**：nodeLabel 结果按节点 Map 缓存；过滤 checkbox 150ms 防抖或 useTransition | 低 | 小中 | 立即 | Profiler render 次数 |
| 交互层 | **I2 O(1) 命中与无 React 高亮**：命中走 D3 quadtree，高亮只置 canvas 重绘标志不走 setState | 低 | 中 | 与 D3 配套 | hover 无 long task |
| 交互层 | **I3 交互期冻结布局**：拖拽/滚轮时 alpha 置 0，松手 reheat——交互帧率优先 | 低 | 中高（拖拽丝滑感） | 立即 | 拖拽中 fps 与引擎 tick 数 |

## 3. 最小可行优化路径（只做 3 件）

1. **R1 渲染属性预计算（含 I1 tooltip 缓存）**——小时级工作量消除每帧百万级分配/查找，抬升所有规模帧率地板，且为 R2 自绘铺路。
2. **C1+C3 收敛调优与坐标持久化**——「打开即稳、过滤不炸」，直接决定丝滑的主观感受，零高风险依赖。
3. **R2+D3 视口裁剪与 quadtree**——大规模交互帧率的主要保障，同时产出「是否需要 WebGL」的对照数据：若裁剪后 20k 达标，R4 缓行。

## 4. 模拟数据设计（已实现：`scripts/gen-graph-data.mjs`）

生成模型：社区块模型 + 社区内 Barabási–Albert 优先连接（无标度度分布+枢纽）+ 跨社区枢纽桥接（小世界）+ 预留孤立节点。固定 seed 可复现，参数全可调。

| 数据集 | 节点 | 边 | 拓扑特征 | 生成命令（已生成并实测） | 压测目标 |
|---|---|---|---|---|---|
| graph-small | 500 | ~1,950 | 8 社区、平均度 7.8、max 度 52、孤立 1% | `node scripts/gen-graph-data.mjs -n 500 -c 8 -d 8 --cross-ratio 0.1 --isolated-ratio 0.01 --out public/fixtures/graph-small.json --seed 42` | 局部交互手感（hover/拖拽/单点选中） |
| graph-mid | 5,000 | ~15,500 | 20 社区、平均度 6.2、max 度 68、孤立 3%、四类掌握状态混合 | `... -n 5000 -c 20 -d 6 --cross-ratio 0.08 --isolated-ratio 0.03 --out .../graph-mid.json --seed 7` | 整体布局收敛与全量渲染 |
| graph-large | 20,000 | ~61,300 | 40 社区、max 度 117、孤立 3%、7.75MB JSON | `... -n 20000 -c 40 -d 5 --cross-ratio 0.06 --out .../graph-large.json --seed 11` | 暴露性能瓶颈（帧率/内存/长任务） |
| (边界) | 20k–50k | — | 同上参数化；50k/15.8 万边 0.64s 生成、19.8MB 已验证 | 改 `-n`/`-c`/`-d` 即得 | WebGL/聚合方案的立项依据 |

访问方式：`/graph?fixture=graph-mid`（页面显示压测模式角标）；fixtures 已加入 .gitignore，按需重新生成。

## 5. 压测指标与通过标准

| 指标 | 小规模(500) | 中规模(5k) | 大规模(20k) |
|---|---|---|---|
| 首帧可见时间* | <1.5s | <3s | <6s（50k：<10s 或降级静态布局） |
| 拖拽/缩放平均帧率** | ≥55fps | ≥45fps | ≥30fps（50k 平移 ≥24fps） |
| 布局稳定时间*** | <3s | <8s | <20s |
| 内存增量**** | <50MB | <200MB | <500MB |
| 主线程最长阻塞***** | <100ms | <200ms | <300ms |

采集方法：* Performance mark：数据加载起点→ force-graph 首次 onEngineTick；** puppeteer/CDP 恒速拖拽 10s + rAF 采样帧直方图；*** onEngineStop 打点或「连续 60 帧平均位移 <0.5px」；**** Chrome `--enable-precise-memory-info` 下 performance.memory 加载前后差；***** PerformanceObserver('longtask')。环境基线：【待确认：目标设备与浏览器矩阵，建议以「桌面 Chrome + 一台入门级安卓」为下限】。

## 6. 迭代建议（可独立测试变量）

| 变量 | 取值 | 观测方式 |
|---|---|---|
| V1 布局参数 | theta(0.6/0.9/1.2) × alphaDecay(0.02/0.023/0.03) | onEngineStop 收敛时长、收敛后平均边长标准差、前 5s fps 曲线 |
| V2 裁剪与预计算 | 预计算 on/off × 视口裁剪阈值(关/8k/4k) | 三档 fixture 拖拽/缩放 p95 帧耗时、Paint 时间占比、Minor GC 频次 |
| V3 数据形态 | 全量明细 vs 社区聚合(D2) | 50k fixture 首帧时间、内存增量、最大 Long Task |

每轮只动一个变量，用同一 seed 的 fixture 保证拓扑一致；先跑 V2 中的预计算开关（成本最低、证据最快）。

## 7. 基线实测记录（2026-10-29）

环境：Windows 11 / Intel i7-12700H / Headless Chrome 156 / 1440×900。采集脚本 `npm run perf:graph`，原始数据 `artifacts/graph-baseline.json`。

| 数据档 | 节点 | JSON | 首 tick | 引擎停止 | rAF FPS | p95 帧耗时 | JS heap | 最长 long task |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| graph-small | 500 | 179 KB | 1.04s | 1.67s | 144.3 | 7.9ms | 30.4 MB | 167ms |
| graph-mid | 5,000 | 2.23 MB | 1.07s | 16.19s | 5.9 | 227.8ms | 56.2 MB | 164ms |
| graph-large | 20,000 | 3.58 MB | 1.12s | 16.10s | 3.4 | 400.0ms | 47.3 MB | 232ms |

结论：

- 5k 以上瓶颈已从数据解析转向力布局与 Canvas 全量绘制，未达到本方案 45/30fps 目标。
- 已落地视口剔除、低透明度节点跳过、规模自适应 theta、拖拽重热、sprite 缓存与 deferred 过滤；同色批量绘制因每个节点采用独立径向渐变 sprite 而不再适用。
- 鼠标命中由 force-graph 的 shadow canvas 单像素查询完成，已是 O(1)，无需额外维护 quadtree。
- 20k 仍低于 30fps，WebGL 具备立项数据依据；但引入新依赖/改变渲染栈需产品确认，暂不自动实施。

## 8. 实施记录：U6 拖拽物理与星系布局（2026-11-01）

> 背景：用户反馈「节点拖动卡顿、僵硬」，要求星系式汇聚布局。诊断手段：页内注册 d3 力探针（`d3Force('__probe', alpha => log(alpha))`）直接观测拖拽期 alpha 轨迹与 tick 数（临时脚本，已删）。

### 8.1 根因（与 §1 假设的修正）

| 根因 | 机制 | 验证方式 |
|---|---|---|
| 拖拽期 alpha=1 全量重热 | `onNodeDrag` 每次 `d3ReheatSimulation()`（alpha=1），与库内建「拖拽期 alphaTarget(0.3) 低强度跟随」冲突；5000 节点重热后 10+ tick 跑满速（p95 56.9ms→掉帧） | drag-verify 基线：graph-mid 拖拽 avg 15.5ms / p95 56.9ms |
| `pinInitial` 钉死全部节点 | 邻居完全不动（僵硬）、拖拽期引擎 tick 全部空转；节点被钉住时 warmup/收敛调参全部失效 | alpha 探针：拖拽期间 tick 全部无位移 |
| 静止后拖拽引擎立即自停 | 收敛后 alpha≈0.0075 < alphaMin(0.01)，拖拽 `resetCountdown` 后第一个 layoutTick 即自停——邻居弹性跟随从未生效 | alpha 探针：修复前拖拽期 0 次 tick |
| 预布局卫星环公式爆炸 | 两环容量 9 vs graph-mid 211 个 doc 簇，`r/sin(π/201)` 把环半径推到 41720px（去 pin 后才暴露；钉住时代被冻结在过渡态掩盖） | vitest 力栈复现：t=0 即 41720 |
| 挂载时 charge 未落配置值 | 只在用户调参时写 strength，首次加载一直用 d3 默认 −30 | 代码审查 |

### 8.2 改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/graph/graph-drag.ts`（新增） | 拖拽模式决策（`dragModeFor`：≤2000 实时弹性 / >2000 冻结保帧率）、轨迹采样 `recordDragSample`、释放初速度 `releaseVelocity`（120ms 窗口 + 55px/tick 限幅）、滑翔/收敛窗口常量 |
| `src/lib/graph/graph-layout.ts` | 卫星簇放置改为**向日葵螺旋贪心装箱**（黄金角 + 逐对不重叠检查 + 密度梯度指数 0.75）；删除两环公式（sin(π/N) 爆炸源）。graph-mid 预布局 41720 → 2637px |
| `src/lib/graph/graph-state.ts` | `computeLinkPaints`（连线颜色/宽度预计算，访问器退化为 Map.get）；`computeLinkColor` 的 KINDS.find → Map；CanvasNode 补 vx/vy |
| `src/lib/graph/graph-forces.ts` | `createCenterGravityForce` 消除每 tick 的 filter 双数组分配（movable 缓存，固定数变化时才重建） |
| `src/app/graph/mount-utils.ts` | 新增 `segmentInsideViewport`（Liang-Barsky 线段-视口相交，连线剔除防长边闪现） |
| `src/components/graph/KnowledgeUniverse.tsx` | 移除 `pinInitial` 与拖拽重热；新拖拽协议（开始：按规模选模式 + alphaMin 置 0 + 力减负；释放：惯性注入 + 滑翔窗口低阻尼 + 自愈重热）；`applyEngineForces` 补写 charge 配置强度；锚点强度 0.2 → 0.32 |
| `src/components/graph/GraphCanvas.tsx` | `onRenderFramePre` 每帧缓存 transform（替代每节点 getTransform）；`linkVisibility` 视口剔除；`linkPaints` 预计算接入；`dragVelocityDecay/dragCooldownTicks/dragAlphaMin` props 透传；拖拽期跳过 onEngineStop 的 O(n) 缓存；ALPHA_DECAY 0.25 → 0.06（去 pin 后力导向需要收敛跑道，冻结在过渡态会出鱼骨长条）；跨簇长边弹簧弱化 0.35×（去星芒） |

### 8.3 实测（1440×900，Chrome headless，`artifacts/drag-verify.mjs` + `measure-layout.mjs`）

| 指标 | graph-small（500，live） | graph-mid（5000，frozen） |
|---|---|---|
| 拖拽 fps（基线→改后） | 无真实拖拽（假阳性）→ **126.6**（avg 7.9ms / p95 12.9ms） | 64.7 → **70.4**（avg 14.2 / p95 60.3ms） |
| 释放后收敛 | 引擎不停（25s 超时）→ **0.4s** 确定自停 | 14.4s（cooldownTime 兜底）→ **5.3s** 确定自停 |
| 布局 §4.1 | 圆度 1.366 / 密度 0.540 / 外缘 0.819 ✅ | 圆度 1.074 / 密度 0.654 / 外缘 0.621 ✅ |

说明：
- 拖拽期邻居弹性跟随由库内建 `alphaTarget(0.3)` 驱动，实测拖拽期 alpha 恒 0.3（约 250 tick）；释放后 `d3AlphaTarget(0)`，alpha 0.3→0.01 约 13 tick 自停。
- 「卡死自愈」：滑翔窗口结束若引擎一次未 tick（`d3AlphaTarget` 链路偶发未接通），强制重热保证收敛自停。
- 交互回归：暂停/继续、悬停、右键、路径高亮、小地图不受影响（纯力层/绘制层改动）；e2e 6/6、单测 401/401、typecheck/lint/build 全绿。

## 9. 拖拽手感调参：灵敏度与触发间隔（2026-11-01）

> 背景：§8 解决了「卡顿/僵硬」，但松手手感仍不对。本轮只调交互参数与采样策略，不动布局与力配置。

### 9.1 定位（现象 → 触发条件 → 机制）

| 现象 | 触发条件 | 机制 |
|---|---|---|
| **松手完全没有惯性**（"啪"地停住） | 任意拖拽释放 | `onNodeDragEnd` 先 `resetDragSamples()` 再 `releaseVelocity()`，后者恒读到空数组 → 初速度恒为 0。§8 声称落地的惯性实际从未生效 |
| **停住再松手仍会飞出去** | 拖到目标位置停顿 >100ms 后松手 | 速度窗口是"最近 120ms"，停顿期间没有新样本，但旧样本仍在窗口内，末样本与首样本的位移仍很大 |
| **同样手势不同鼠标手感不一致** | 1000Hz 游戏鼠标 / 高刷屏 | 每个 `pointermove` 都入样，32 条硬上限把 120ms 窗口实际截断到 ~32ms——窗口只剩松手前减速段，高频设备反而"更迟钝" |
| **甩出去过冲再被拽回** | 快速甩动释放 | `RELEASE_VELOCITY_GAIN=2.2` 把指针速度放大 2.2×，叠加 `GLIDE_VELOCITY_DECAY=0.3` 延长滑翔，锚点弹簧再把节点拉回 |
| **手抖/微调也让节点漂走** | 慢速拖拽释放（<140px/s 屏幕速度） | 没有最小速度闸，任何非零位移都换算成惯性 |
| **单击节点会把它推走几像素** | 按下后指针移动 1–5px | force-graph 在阈值判断**之前**就写了 `obj.x/y`（`/k` 折算处），5px 阈值只决定是否取消 click；`DRAG_CLICK_TOLERANCE_PX` 不可配置，属库约束 |

### 9.2 参数调整

| 参数 | 旧值 | 新值 | 作用 |
|---|---|---|---|
| `RELEASE_VELOCITY_GAIN` | 2.2 | **1.0** | 拖拽期节点与指针 1:1，1.0 = 按松手前原速继续；>1 必然过冲 |
| `RELEASE_MAX_SPEED` | 55 px/tick | **30** | 1800px/s 已快于任何有意拖拽，超出只会射出视口 |
| `RELEASE_STALE_MS` | — | **90ms** | 停稳闸：末条轨迹早于 90ms → 判定已停住，不注入惯性 |
| `RELEASE_MIN_SCREEN_SPEED` | — | **140px/s** | 速度闸：手抖/微调不产生滑行；按缩放折算成屏幕速度，跨缩放一致 |
| `SAMPLE_MIN_INTERVAL_MS` | — | **8ms** | 触发间隔：采样归一到 ~125Hz，窗口内稳定 ~15 条，与设备轮询率解耦 |
| 采样条数上限 | 32 | **48** | 240ms / 8ms = 30 条，留 1.6× 余量（仅异常时钟兜底） |
| `GLIDE_VELOCITY_DECAY` | 0.3 | **0.34** | 滑翔略短、收敛更快，减少过冲 |
| `GLIDE_SETTLE_MS` | 320 | **300** | 低阻尼窗口与衰减同步收短 |

顺序修正：`releaseVelocity` 必须在 `resetDragSamples` **之前**调用；拖拽开始补记起点样本（极短拖拽只有一两次 pointermove，缺起点会因样本不足放弃惯性）。

### 9.3 实测

| 指标 | graph-small（500，live） | graph-mid（5000，frozen） |
|---|---|---|
| 拖拽 fps | **143.6**（avg 7.0ms / p95 7.8ms） | 70.4 → **73.2**（avg 13.7 / p95 31.3ms） |
| 释放后收敛 | **219ms** | 5.3s → **2.35s** |

惯性探针 `artifacts/drag-release-verify.mjs`（读取 `__kbDragRelease` 埋点 + 松手点到位移距离）：

| 手势 | 注入初速度 | 松手后位移 |
|---|---|---|
| 快拖即松（约 600px/s @ k=2.2） | **4.28 px/tick** | 76px（含锚点回拉） |
| 停 160ms 再松 | **0**（停稳闸拦截） | 48px（纯锚点回拉） |

门禁：单测 405/405、typecheck、lint 0 error、build 全绿。
