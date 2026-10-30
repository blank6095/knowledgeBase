# 关系图谱丝滑度优化方案（含压测数据体系）

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
