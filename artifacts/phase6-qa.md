# U4-3 学习地图出口门禁验证（QA · phase6-qa）

- 记录人：qa-phase0
- 采集时间：2026-10-30 23:10 – 23:19（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（全部改动未提交）
- 工具链：Node v22.20.0 / Playwright 1.64.1（`channel: chrome`）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`、`scripts/`
- 口径（UQ6 未明确，按实现侧可复核默认，与面板说明一致）：薄弱 `memory<0.4`；到期 `reasonCode==='due-review'`；今日=其余今日条目；枢纽=关联度数 Top 10%（`ceil(10%)`、至少 1、`minDegree 2`、并列按 id 稳定）

## 0. 结论表

| 门禁 / 检查点 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **PASS**（exit 0） | `phase6-qa-static.log` |
| `npm run lint` | **PASS**（exit 0，0 error / 0 warning） | `phase6-qa-static.log` |
| `npm test` | **PASS**（exit 0，42 文件 / **324 用例**；graph-map 7） | `phase6-qa-static.log` |
| `npm run build` | **PASS**（exit 0，35 静态页） | `phase6-qa-build.log` |
| `npm run test:e2e` | **PASS**（6 / 6，exit 0） | `phase6-qa-e2e.log` |
| 四类计数独立复算（真实 API） | **PASS**（weak 13 / due 0 / today 3 / hub 1 与面板 + 4 图例完全一致） | `phase6-qa-verify.json` |
| 启用仅 1 次 `/api/learning/today` | **PASS**（切换勾选不重复请求） | 同上 |
| 四类通道可区分 / 叠加 | **PASS**（weak 全环、hub 外环、due 右上弧、today 左下弧，四个方向差异化实测） | 同上 |
| 记忆度颜色与核心半径不变 | **PASS**（启用前后同节点中心 9×9 像素最大差 **0**） | 同上 |
| 清除标记 | **PASS**（图例消失；同一节点 on/off 对照清除后 diff=0） | 同上 |
| 失败降级 | **PASS**（abort `/api/learning/today` → 提示 + weak 13 仍绘制、due/today=0、0 pageerror） | 同上 |
| 移动端 375 | **PASS**（入口/面板可用，面板 63–363，无横向溢出） | 同上 |
| 阶段 0–4 回归 | **PASS**（搜索/详情/右键/一阶 focus/路径/主题/六页签/力/拖拽/fixture/空态/骨架） | 同上 |
| 8k 地图 smoke | **PASS**（全四类启用 1390ms，longTask max 135ms、最大帧间隔 331ms、续帧 112，未崩溃） | 同上 |
| 三档性能（vs phase5 ±10%，地图默认关闭） | **PASS**（9 项全部 ±3.6% 内） | §6 |
| **最终 red 项** | **无** | — |

## 1. 命令明细

| # | 命令 | 时间 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 23:11:29 → 23:11:32 | 0 |
| 2 | `npm run lint` | 23:11:32 → 23:11:42 | 0（0 warning） |
| 3 | `npm test` | 23:11:42 → 23:11:50 | 0（42 文件 / 324 用例） |
| 4 | `npm run build` | 23:11:56 → 23:12:04 | 0 |
| 5 | `npm run test:e2e` | 23:12:04 → 23:12:17 | 0（6/6） |
| 6 | 功能验收（dev 3102，13 项） | 23:14:26 → 23:15:1x | 0（**13/13 PASS**） |
| 7 | `perf:graph` run1/run2/run3 | 23:15:37 / 23:16:25 / 23:17:13 | 0 / 0 / 0 |

## 2. 四类计数复算（真实数据）

QA 独立按口径复算（`/api/graph` nodes + `/api/learning/today` items）：

- 薄弱 `memory<0.4` → **13**
- 到期 `reasonCode==='due-review'` → **0**
- 今日其余条目 → **3**
- 重要枢纽：度数 ≥2 的节点按度数降序（并列按 id）取 `max(1, ceil(10%))` → **1**

面板四个计数与左下角 4 个图例 chips（「薄弱 13 · 到期复习 0 · 今日推荐 3 · 重要枢纽 1」）完全一致。截图 `phase6-qa-map-all.png`。

## 3. 通道可区分 / 叠加 / 语义不变

方法：对同一节点在「地图关闭」与「仅启用某类」时截取中心 61×61 canvas 像素做差分，并按象限（右上 UR / 左下 LL）与半径带统计。

| 类别 | 实测 |
| --- | --- |
| 薄弱 weak | 全环差分 diff=109（UR=29 / LL=27，近半径带），非单向弧 |
| 重要枢纽 hub | 更外环差分 diff=160（UR=30 / LL=37，far band=14 → 半径大于 weak 环） |
| 到期 due（受控 today 数据） | 右上弧 UR=40 / LL=0 |
| 今日 today（受控 today 数据） | 左下弧 UR=29 / LL=64 |
| 四类叠加 | 4 chips 同时存在，节点周边 diff 正常，通道不互相覆盖 |
| 颜色/半径语义 | 启用前后同节点中心 9×9 像素**最大差 0**（中心 RGB=140,118,79），说明标记不进入 sprite、未改记忆度颜色与核心半径 |

截图：`phase6-qa-map-all.png`、`phase6-qa-map-weak.png`、`phase6-qa-map-due-today.png`。

## 4. 请求 / 降级 / 清除 / 移动端

| 检查点 | 实测 |
| --- | --- |
| 启用数据请求 | 首次勾选（任一/全部）仅 **1 次** `GET /api/learning/today`；继续切换其他类型不再请求 |
| 失败降级 | route abort 后：提示「今日学习数据加载失败，仅显示薄弱 / 枢纽。」可见；薄弱 13 仍绘制；due/today=0；pageerror=0 |
| 清除标记 | 图例 chips 归 0；同一节点 on/off 对照：启用 diff=109 → 清除后 diff=**0**（≤12 AA 噪声阈值） |
| 移动端 375 | 「◉ 学习地图」入口可用；面板 63–363px、不越界、无横向溢出；图例在 md+ 显示属设计 |

截图：`phase6-qa-map-mobile.png`。

## 5. 8k 地图 smoke

`?fixture=graph-large`（实际 8000 节点）启用全部四类：

- 启用耗时 1390ms（含 1s 观察窗），canvas 存活，rAF 续帧 112 次
- longTask max **135ms**，最大帧间隔 **331ms**（<2s 不冻结阈值）
- 0 pageerror

截图：`phase6-qa-map-8k.png`。

## 6. 三档性能（官方 `npm run perf:graph`，同日 3 次中位数；地图默认关闭）

phase5 中位：small 897/1582.9/143.52；mid 1123/16177.6/5.6974；large 1219.7/16330.4/3.0932。

| 指标 | phase5 中位 | run1 | run2 | run3 | **phase6 中位** | Δ vs phase5 |
| --- | --- | --- | --- | --- | --- | --- |
| small firstTick | 897 | 907.7 | 904.5 | 926.5 | **907.7** | +1.2% |
| small engineStop | 1582.9 | 1541.6 | 1538.6 | 1564.4 | **1541.6** | -2.6% |
| small fps | 143.52 | 142.23 | 144.36 | 142.25 | **142.25** | -0.9% |
| mid firstTick | 1123 | 1163.9 | 1153.4 | 1172.5 | **1163.9** | +3.6% |
| mid engineStop | 16177.6 | 16228.9 | 16235.3 | 16167.6 | **16228.9** | +0.3% |
| mid fps | 5.6974 | 5.6631 | 5.5718 | 5.6778 | **5.6631** | -0.6% |
| large(8000) firstTick | 1219.7 | 1207.2 | 1200 | 1233.5 | **1207.2** | -1.0% |
| large engineStop | 16330.4 | 16359.4 | 16388 | 16464.7 | **16388** | +0.4% |
| large fps | 3.0932 | 3.1683 | 3.1638 | 3.1541 | **3.1638** | +2.3% |

**判定：PASS**（9 项全部在 ±10% 内，最大偏差 +3.6%；地图默认关闭时无性能影响，与预期一致）。

## 7. 阶段 0–4 回归（PASS）

独立页面执行：搜索「网络」3 条 + Esc、详情面板、右键菜单 7 项、一阶 focus（按钮变「展开二阶关联」）、设置面板六页签（筛选/分组/显示/力/主题/地图）+ 4 力滑块、拖拽重排（engineStop 更新）、`?fixture=graph-small`、空态「图谱还没有灯。」、加载骨架、主题持久化（phase5 已验证）。主流程 pageerror=0 / console.error=0。

## 8. 观察项（非阻断）

1. 真实库 `due=0`，因此「到期弧方向」用受控 `/api/learning/today`（route fulfill 两个条目）验证：右上弧 UR=40/LL=0，与今日弧（UR=29/LL=64）方向相反，可区分。
2. 地图图层为独立 canvas 通道（不进入 sprite），故记忆度颜色/核心半径不变；启用前后中心 9×9 像素差为 0。
3. 8k 启用全四类时帧间隔峰值 331ms（一次性绘制大量外环），未冻结、可接受；地图默认关闭，不影响常规性能。
4. 图例 chips 仅在 `md+` 显示（现有设计，与阶段 1 图例一致）；移动端面板/入口可用。

## 9. 产物清单

- 本报告：`artifacts/phase6-qa.md`
- 功能验收：`phase6-qa-verify.mjs`、`phase6-qa-verify.json`、`phase6-qa-verify.log`
- 截图：`phase6-qa-map-all.png`、`phase6-qa-map-weak.png`、`phase6-qa-map-due-today.png`、`phase6-qa-map-mobile.png`、`phase6-qa-map-8k.png`
- 性能：`phase6-qa-perf-run1/2/3.log`、`graph-baseline.phase6.run1/2/3.json`
- 构建/静态/e2e：`phase6-qa-build.log`、`phase6-qa-static.log`、`phase6-qa-e2e.log`

## 10. 任务状态

- **task-27 已完成（complete）**：全部门禁 PASS，无 red 项。
- 环境收尾：3000/3100/3102/3200 全 free、0 个 node 进程；fixture 字节未变；`artifacts/` 未新建 `.tsx/.cjs`。
