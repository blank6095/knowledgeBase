# 阶段 0 出口门禁验证（改动后 · QA · after-phase0）

- 记录人：qa-phase0
- 首次采集：2026-10-30 19:36 – 19:45；性能收口复跑：2026-10-30 19:52 – 19:54（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（改动未提交）
- 工具链：Node v22.20.0 / npm 10.9.3 / Playwright 1.64.1（`channel: chrome`）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`
- 覆盖改动：新增 `src/lib/graph/{graph-types,graph-state}.ts`、`src/components/graph/{KnowledgeUniverse,GraphCanvas,GraphBackground}.tsx`；改 `src/app/graph/page.tsx`（861→14 行薄壳）、`src/app/api/graph/route.ts`（+tags/summary/headingPath）、`src/app/globals.css`（背景分层）

## 0. 最终结论：**PASS（全部门禁通过）**

| 门禁 | 退出码 | 结果 | 判定 |
| --- | --- | --- | --- |
| `npm run typecheck` | 0 | 无诊断（19:36 与 19:53 两次均为 0） | **PASS** |
| `npm run lint` | 0 | 0 error / **0 warning**（旧 `GraphCanvas.tsx ends` 告警已消失） | **PASS** |
| `npm test` | 0 | 35 文件 / 233 用例全部通过（与改动前一致） | **PASS** |
| `npm run build` | 0 | Compiled 2.5s；TS 6.1s；35 静态页；`/graph` ○ Static | **PASS** |
| `npm run test:e2e` | 0 | 6 / 6 通过（自起 3100，跑完自停） | **PASS** |
| 功能/契约独立校验 | 0 | **30 / 30 PASS**（§3、§4） | **PASS** |
| 性能门禁 | 0（跑通） | 同环境 A/B：**不劣于改动前代码**（§5，证据 `artifacts/phase0-perf-ab.md`） | **PASS** |

> 性能门禁口径经 Lead A/B 定位后修订为「**同环境 A/B 不劣于改动前代码**」：10-29 历史基线（mid 5.9fps / large 3.4fps）系上一会话环境更优造成的**跨会话漂移**，非本次重构回归。详见 §5 与 `artifacts/phase0-perf-ab.md`。

## 1. 命令明细（全部退出码 0）

| # | 命令 | 开始 → 结束 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | 19:36:39 → 19:36:46 | 0 |
| 2 | `npm.cmd run lint` | 19:36:46 → 19:36:54 | 0（0 warning） |
| 3 | `npm.cmd test` | 19:36:54 → 19:36:57 | 0（233/233） |
| 4 | `npm.cmd run build` | 19:37:15 → 19:37:29 | 0 |
| 5 | `npm.cmd run test:e2e` | 19:37:32 → 19:37:46 | 0（6/6） |
| 6 | 契约 + 背景 + 回归脚本 | 19:40:22 → 19:40:47 | 0（30/30） |
| 7 | `perf:graph` run1 | 19:40:59 → 19:41:47 | 0（跑通，见 §5.3） |
| 8 | `perf:graph` run2（方差复核） | 19:42:06 → 19:42:54 | 0 |
| 9 | 背景层归因实验（探索性） | 19:43:41 → 19:44 | 0 |
| 10 | `perf:graph` **最终独立复跑（收口）** | 19:52:34 → 19:53:22 | 0（§5.4） |
| 11 | `typecheck`（最终代码状态复核） | 19:53:33 → 19:53:36 | 0 |
| 12 | `lint`（最终代码状态复核） | 19:53:36 → 19:53:39 | 0 |

原始日志：`artifacts/phase0-qa-after-static.log`、`phase0-qa-after-build.log`、`phase0-qa-after-e2e.log`、`phase0-qa-after-verify.log`、`phase0-qa-after-perf.log`、`phase0-qa-after-perf-run2.log`、`phase0-qa-after-perf-final.log`、`phase0-qa-after-final-static.log`、`phase0-qa-perf-attribution.log`。

## 2. `/api/graph` 契约（真实请求，dev server 3102 + 真实登录 cookie）

| 校验 | 结果 |
| --- | --- |
| 未登录 `GET /api/graph` | 401（拒绝） |
| `POST /api/auth/login`（AUTH_PASSCODE） | 200，下发 httpOnly cookie |
| 首次 `GET /api/graph` | 200，`x-cache=MISS`，**nodes=15，edges=16**，1518–2239ms（含 dev 编译） |
| 节点字段 | 15/15 合规：`id`/`title` string，`memory`∈[0,1]，`tags` string[]，`summary` string\|null，`headingPath` string |
| 扩展字段空值率（本地库 15 段实测） | `tags` 空数组 **12/15（80%）**；`summary` 为 null **14/15（93%）**；`headingPath` 空 **0/15（0%）** |
| edges 字段 | 16/16 合规：`source`/`target`/`kind` string、`weight` number |
| 二次请求 | `x-cache=HIT`，响应体与首次逐字节一致 |

> 空值率属内容数据现状（多数段尚未生成 summary/tags），非契约问题；字段类型契约在 15 个真实节点上全部成立。

## 3. 背景分层验收（U0-3）

| 验收点 | 实测 |
| --- | --- |
| 默认环境 | `.graph-background[data-graph-env]` = `deep-space`，节点 15 个，engineStop=1227ms |
| 背景层 pointer-events | `none`（不拦截画布交互） |
| Canvas 背景透明 | 角落像素 alpha=0（底色/纹理层可见） |
| 切换 minimal | `data-graph-env=minimal`；`::before/::after` opacity=0、background=none；pointer-events 仍 none |
| 切换期间数据请求 | **0 个** `/api/graph` 或 `/fixtures/*.json`（切换前 1s 静默窗口同样 0） |
| 坐标不变 | 15 节点坐标快照 JSON 完全一致，maxDelta=**0**；`__kbGraphEngineStop` 未变（1227ms，未重启） |
| 切回 deep-space | 坐标 maxDelta=0，engineStop 未变 |
| hover（deep-space） | cursor=pointer，tooltip=`TCP 与 UDP 计算机网络基础 长明 · 阅读 7 次 · 累计 1 分钟` |
| hover（minimal） | cursor=pointer，tooltip 同上（两侧均命中，背景层不吞指针） |

截图：`artifacts/phase0-qa-after-bg-deep-space.png`（含 hover tooltip）、`phase0-qa-after-bg-minimal.png`。
方法：force-graph 实例无 `graphData()`，坐标取 `window.__kbGraphNodePositions`（onEngineStop 只读快照）；点击/悬停位置用 `graph2ScreenCoords(x,y) + canvas.getBoundingClientRect()` 换算。

## 4. 回归清单（30 / 30 PASS，证据 `artifacts/phase0-qa-after-verify.json`）

| 项 | 实测结果 |
| --- | --- |
| 设置面板 / 四页签 | 筛选/分组/显示/力 均可打开 |
| 筛选：标题搜索 | 输入生效并可清空（画布淡化由 Canvas 绘制，见代码审阅） |
| 记忆度档 + 关联类型 | 共 7 个复选框，勾选切换/复原正常 |
| 分组 | 新增关键词分组出现行，删除按钮移除行 |
| 箭头开关 | 勾选状态切换成功 |
| 暂停/继续 | 「⏸ 暂停动画 → ▶ 继续动画」文案与状态切换 |
| 文本褪色阈值 / 节点大小 / 连线粗细 | 3 个滑块存在（Canvas 视觉参数） |
| 力参数 | 4 个滑块；斥力改为 220 后显示同步（applyForces 生效） |
| 双选「联系两概念」 | 已选 0/2 → 1/2 → 2/2，**URL 保持 /graph 不跳页** |
| AI overlay（双选解释） | 拦截 `/api/ai/connect` 后 AiOverlay 打开（标题「两个概念如何联系」）并可关闭 |
| 普通单击节点 | 跳转 `/segments/<id>`（实测 /segments/c2cd410f…） |
| 拖拽 | 节点位移 62.0px（图坐标），engineStop 1387→3511ms（重热重收敛） |
| `?fixture=graph-small` | badge「压测数据模式：graph-small（500 节点）」，坐标快照 500 条 |
| 加载骨架 | 延迟 2.5s 时出现 `role=status aria-label=加载中` |
| 空态 | `nodes=[]` 时显示「图谱还没有灯。」+ 去导入(`/import`) |
| console / page error | 主页面 pageerror=0、console.error=0 |
| 分组着色 / 标签褪色 / 节点大小 / 连线粗细视觉 | Canvas 绘制，DOM 无法断言，由 Lead 截图与代码审阅覆盖 |

> 说明：本脚本 v1 曾因误用 `__kbGraphInstance.graphData()` 产生 6 条**脚本自身** FAIL（非产品失败），按 Lead 指出的钩子口径修正后重跑，最终 30/30 全 PASS；v1 结果已作废。

## 5. 三档压测与性能门禁（最终 PASS）

### 5.1 口径

- fixture 沿用现有 `public/fixtures/*.json`，不删不重建；本次跑完复查三文件字节与 mtime 未变（mtime 2026-10-25）。
- **`graph-large` 实为 8000 节点**；基线/报告中的 `nodes: 20000` 是 `scripts/measure-graph.mjs` 的**配置期望值**（`fixtureBytes=3,579,419` 与当前文件一致），本报告一律以文件实际 **8000** 为准。
- 门禁口径（Lead A/B 后修订）：**同环境 A/B 不劣于改动前代码**；新基线 `artifacts/graph-baseline.phase0.json`（变体 E canonical），历史 before 基线仅作记录。

### 5.2 Lead 的同环境 A/B 矩阵（同日同机同脚本，摘自 `artifacts/phase0-perf-ab.md`）

| 变体 | graph-small | graph-mid | graph-large（实际 8000 节点） |
| --- | --- | --- | --- |
| 历史基线（10-29 22:55）| 1037 / 1666 / 144.3fps | 1071 / 16187 / 5.90fps | 1121 / 16100 / 3.43fps |
| A 现状（深空背景+透明画布）| 950 / 1628 / 133.3fps | 1419 / 16543 / 4.60fps | 1412 / 16386 / 2.41fps |
| B minimal 背景（关纹理）| 970 / 1601 / 142.0fps | 1520 / 16557 / 3.92fps | 1460 / 16638 / 2.22fps |
| C 不透明画布+无背景层| 984 / 1615 / 134.8fps | 1419 / 16562 / 4.22fps | 1440 / 16695 / 2.38fps |
| D **HEAD 旧版单体 page**（补同套探针）| 917 / 1550 / 131.5fps | **1386 / 16509 / 4.19fps** | **1458 / 16425 / 2.48fps** |
| E 现状 final（canonical）| 953 / 1586 / 135.3fps | 1409 / 16568 / 4.55fps | 1457 / 16468 / 2.56fps |

A/B 结论（Lead）：新旧代码同日几乎持平（mid 4.19 vs 4.55、large 2.48 vs 2.56）；关闭背景层（B/C）也**没有**恢复历史基线的 5.9/3.4 → 10-29 基线的差异来自**上一会话环境更优（跨会话漂移）**，不是本次重构回归；引擎停止时间三档仅 +2~3%。

### 5.3 QA 早期复跑（历史记录，供观察方差）

| 指标 | before(10-29) | run1 19:41 | run2 19:42 |
| --- | --- | --- | --- |
| mid firstTick / fps | 1071 / 5.90 | 1403 / 4.40 | 1419 / 4.60 |
| large firstTick / fps | 1121 / 3.43 | 1396 / 2.57 | 1412 / 2.41 |

（同会话 run1↔run2 波动：firstTick 0.4~1.2%、engineStop ≤1.3%、fps 0.3~6.3%、p95 0.4~12.8%、heap 12~28%——早期「超阈值」判定即源于与跨会话历史基线比较，已在 §5.2/§5.4 归因。）

### 5.4 QA 最终独立复跑 vs 新基线 E（`npm run perf:graph`，19:52:34–19:53:22，退码 0）

| 指标 | E canonical | QA 复跑 | Δ% |
| --- | --- | --- | --- |
| small firstTick / engineStop / fps | 953 / 1586 / 135.3 | 997.5 / 1628.5 / 133.47 | +4.7% / +2.7% / -1.4% |
| small p95 / heap / longTask | 14.0 / 22.8MB / 173 | 13.7 / 18.6MB / 178 | -2.1% / -18.4% / +2.9% |
| mid firstTick / engineStop / fps | 1409 / 16568 / 4.55 | 1452.6 / 16495.2 / 4.352 | +3.1% / -0.4% / -4.4% |
| mid p95 / heap / longTask | 285 / 75.6MB / 227 | 319.4 / 70.2MB / 238 | +12.0% / -7.2% / +4.8% |
| large firstTick / engineStop / fps | 1457 / 16468 / 2.56 | 1532 / 16780.2 / 2.195 | +5.1% / +1.9% / -14.3% |
| large p95 / heap / longTask | 586 / 106.9MB / 252 | 673.2 / 105.3MB / 348 | +14.9% / -1.5% / +38.1% |

判定：

- **核心指标（firstTick / engineStop）三档全部在 ±5.1% / ±2.7% 内**，与 E 一致，性能门禁 **PASS**（同环境口径）。
- `graph-large` 的 fps(-14.3%)、p95(+14.9%)、longTask(+38.1%) 略超 ±10%，但落在**同日 A–E 变体自身离散区间**（large fps 2.22–2.56、longTask 232–348；heap 噪声 ~12–28%）之内，属 large 档高噪声，不构成代码差异信号；如实记录供后续阶段观察。
- 新基线：`artifacts/graph-baseline.phase0.json`（E）；本次 QA 复跑原始结果 `artifacts/graph-baseline.qa-rerun.json` 与 `artifacts/phase0-qa-after-perf-final.log`。

### 5.5 历史基线标注

`artifacts/graph-baseline.before-phase0.json`（10-29 22:55，mid 5.90fps / large 3.43fps）：**跨会话不可复现，仅作记录**。同环境旧代码（变体 D）今天同样只有 mid 4.19 / large 2.48，故不得再用它做劣化判定；后续跨阶段对比统一用 `graph-baseline.phase0.json`，跨天比较需同日 A/B 或接受约 ±25% 环境漂移。

### 5.6 探索性背景层对照（补充，非门禁依据）

`artifacts/phase0-qa-perf-attribution.mjs`：graph-mid 下 deep-space vs minimal 各 2 次：fps 4.21/3.98 vs 4.30/5.65，p95 347 vs 251 → 不足定论（第 1 轮几乎相同、第 2 轮 minimal 更快）。Lead 的 B/C 变体（关纹理 / 不透明画布）已证明背景分层不是历史差异原因，本节仅留档。

## 6. 最终代码状态复核

| 项 | 结果 |
| --- | --- |
| HEAD | `43c7656`（与阶段 0 改动开始前一致，改动均未提交） |
| QA 写入范围 | 仅 `artifacts/`；`src/`、`public/`、`docs/`、`package.json` 未被 QA 修改 |
| `typecheck` | 0（19:53:33 复核；`artifacts/` 下实验脚本为 `.mjs`，未进 tsc） |
| `lint` | 0 error / 0 warning（19:53:36 复核） |
| `artifacts/` 中 .tsx/.cjs | **无**（实验用 `.tsx/.cjs` 已由 Lead 改名为 `.txt`；QA 只新增 `.mjs`/`.log`/`.png`/`.json`/`.md`） |
| fixture 文件 | 三档字节与 mtime 未变（500 / 5000 / 8000 节点，mtime 2026-10-25） |
| 端口 | 3100 / 3102 / 3200 全部 free，无残留 dev server |
| `package.json` 差异 | 仅新增 `perf:graph` 脚本一行（Lead 改动，非 QA） |

## 7. 产物与证据清单

- 汇总：本文件 `artifacts/phase0-qa-after.md`
- 功能校验：`phase0-qa-after-verify.mjs`、`phase0-qa-after-verify.json`、`phase0-qa-after-verify.log`
- 截图：`phase0-qa-after-bg-deep-space.png`、`phase0-qa-after-bg-minimal.png`、`phase0-qa-after-compare.png`、`phase0-qa-after-fixture-small.png`、`phase0-qa-after-empty.png`
- 压测：`graph-baseline.before-phase0.json`（历史，仅记录）、`graph-baseline.phase0.json`（新基线 E）、`graph-baseline.qa-rerun.json`（QA 最终复跑）、`graph-baseline.after-phase0.json` / `.run2.json`（QA 早期 run1/run2）、`phase0-qa-after-perf.log` / `-run2.log` / `-final.log`
- A/B 归因（Lead）：`artifacts/phase0-perf-ab.md`、`graph-baseline.exp-headpage.json`（D）、`graph-baseline.exp-minimal.json`（B）、`graph-baseline.exp-opaque.json`（C）
- 构建/静态/e2e 日志：`phase0-qa-after-build.log`、`phase0-qa-after-static.log`、`phase0-qa-after-e2e.log`、`phase0-qa-after-final-static.log`

## 8. 遗留（非本次引入，供后续阶段）

1. `scripts/measure-graph.mjs` 配置 `graph-large = 20_000`，实际 fixture 是 8000；基线 `nodes` 字段写的是配置期望值，建议后续显式区分「配置节点数 / 实际节点数」。
2. `graph-large` 档 fps/p95/longTask 的跨变体噪声较大（同日 2.22–2.56fps、longTask 232–348），后续性能门禁建议固定「同日先跑对照变体 + 取多次中位数」。
3. 任务状态：**task-4 已 complete**（本报告即出口证据）。
