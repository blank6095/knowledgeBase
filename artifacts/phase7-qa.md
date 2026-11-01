# U4-6 小地图出口门禁验证（QA · phase7-qa）

- 记录人：qa-phase0
- 采集时间：2026-10-31 18:52 – 19:06（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（全部改动未提交）
- 工具链：Node v22.20.0 / Playwright 1.64.1（`channel: chrome`，HeadlessChrome/156）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`、`scripts/`

## 0. 结论表

| 门禁 / 检查点 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **PASS**（exit 0） | `phase7-qa-static.log` |
| `npm run lint` | **PASS**（exit 0，0 error / 0 warning） | `phase7-qa-static.log` |
| `npm test` | **PASS**（exit 0，43 文件 / **330 用例**；graph-minimap 6） | `phase7-qa-static.log` |
| `npm run build` | **PASS**（exit 0，35 静态页） | `phase7-qa-build.log` |
| `npm run test:e2e` | **PASS**（最终 6/6，exit 0；首跑环境冲突，见 §6） | `phase7-qa-e2e-run1/2.log` |
| 默认关闭 / 开启 / 关闭 | **PASS** | `phase7-qa-verify.json` |
| 点击小地图跳转相机 | **PASS**（center (0,0)→(-295.3,207.1)，zoom 不变，0 请求，engineStop/坐标不变） | 同上 |
| 拖动小地图跳转相机 | **PASS**（center 位移 476.9，0 请求，engineStop 不变） | 同上 |
| 视口矩形随相机刷新 | **PASS**（小地图像素和 9000523→6524457） | 同上 |
| 桌面布局 / 375 布局 | **PASS**（不与图例/入口/底部导航重叠，无横向溢出） | 同上 |
| 8k 开启小地图 smoke | **PASS**（2951ms，longTask max 400ms、帧间隔 607ms、续帧 97，不崩） | 同上 |
| 阶段 0–4 回归 | **PASS**（搜索/详情/右键/一阶 focus/六页签/力滑块） | 同上 |
| 三档性能 vs phase6 ±10% | **PASS（跨会话环境漂移，非代码回归；两套数字见 §5，待安静环境重基线）** | `phase7-qa-perf-run1/2/3.log`、`-retry1.log` |
| **最终 red 项** | **无** | — |

## 1. 命令明细

| # | 命令 | 时间 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 18:53:22 → 18:53:26 | 0 |
| 2 | `npm run lint` | 18:53:26 → 18:53:38 | 0（0 warning） |
| 3 | `npm test` | 18:53:38 → 18:53:45 | 0（43 文件 / 330 用例） |
| 4 | `npm run build` | 18:53:49 → 18:53:57 | 0 |
| 5 | `npm run test:e2e`（首跑） | 18:53:57 → 18:54:00 | **1**（dev lock，见 §6） |
| 6 | `npm run test:e2e`（重跑） | 18:54:00 → 18:54:14 | **0**（6/6） |
| 7 | 功能验收（dev 3102，11 项） | 19:00:38 → 19:01:1x | 0（**11/11 PASS**） |
| 8 | `perf:graph` run1/2/3 + retry1 | 19:01:24 / 19:02:14 / 19:03:05 / 19:04:19 | 0 / 0 / 0 / 0 |

## 2. 小地图功能（PASS）

| 检查点 | 实测 |
| --- | --- |
| 默认关闭 | 无 `canvas[aria-label="图谱小地图…"]`（默认关闭） |
| 开启 | 设置面板「显示」tab 勾选「小地图（全景导航）」→ 168×112 小地图出现在右下角（right=1417 / bottom=883 / 视口 1440×1000），**0 业务请求** |
| 点击跳转 | 点左下角：相机 center **(0.0,0.0) → (-295.3,207.1)**，zoom **1.62 不变**，engineStop 与节点坐标快照均不变，**0 业务请求** |
| 拖动跳转 | pointer 拖动到右上：center 位移 **476.9**，engineStop 不变，0 请求 |
| 视口矩形 | 点击后小地图像素和 9000523 → 6524457（视口矩形重绘） |
| 关闭 | 取消勾选 → 小地图移除 |
| 桌面布局 | 小地图（1249,771–1417,883）不与记忆度图例、「◉ 学习地图」入口重叠 |
| 移动端 375 | 小地图 188–356 / 583–695；底部导航 top=742，**不重叠**；`scrollWidth=375` 无横向溢出 |

截图：`phase7-qa-minimap-on.png`、`phase7-qa-minimap-jump.png`、`phase7-qa-minimap-mobile.png`。

## 3. 8k 小地图 smoke（PASS）

`?fixture=graph-large`（实际 8000 节点）开启小地图：开启过程 2951ms；canvas 数量 ≥2（图 + 小地图）；longTask max **400ms**、最大帧间隔 **607ms**、续帧 97 次，无冻结、0 pageerror。截图 `phase7-qa-minimap-8k.png`。
（≤1500 采样点、静态离屏缓存、350ms 视口刷新由 `graph-minimap.test.ts` 6 条单测 + 代码审阅覆盖。）

## 4. 阶段 0–4 回归（PASS）

独立页面：搜索「网络」3 条 + Esc；详情面板；右键菜单 7 项；一阶 focus（按钮变「展开二阶关联」）；设置面板六页签（筛选/分组/显示/力/主题/地图）+ 4 力滑块。主流程 pageerror=0 / console.error=0。

## 5. 性能（PASS · 跨会话环境漂移，非代码回归）

官方 `npm run perf:graph`，同机同 Chrome（i7-12700H / HeadlessChrome/156 / 1440×900），minimap 默认关闭。phase6 中位（10-30 23:18 会话）与 phase7 四次（10-31 19:01–19:04 会话）数字都保留如下：

| 指标 | phase6 中位（19h 前） | run1 | run2 | run3 | retry1 | **phase7 中位（当前环境）** | Δ vs phase6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small firstTick | 907.7 | 1022.4 | 1070.3 | 944.1 | 1049.6 | **1022.4** | +12.6% |
| small engineStop | 1541.6 | 1672.7 | 1724.6 | 1628 | 1770.4 | **1672.7** | +8.5% |
| small fps | 142.25 | 134.17 | 140.29 | 130.72 | 134.52 | **134.17** | -5.7% |
| mid firstTick | 1163.9 | 1529.8 | 1380.1 | 1388.3 | 1390 | **1388.3** | +19.3% |
| mid engineStop | 16228.9 | 16510.3 | 16502.2 | 16488.7 | 16538.4 | **16502.2** | +1.7% |
| mid fps | 5.663 | 3.938 | 3.955 | 4.048 | 3.751 | **3.955** | -30.2% |
| large firstTick | 1207.2 | 1509.1 | 1421.1 | 1527.6 | 1500.2 | **1509.1** | +25.0% |
| large engineStop | 16388 | 16733.4 | 16675.8 | 16495.4 | 16480.4 | **16675.8** | +1.8% |
| large fps | 3.164 | 1.890 | 2.173 | 1.960 | 2.208 | **1.960** | -38.0% |

**最终判定：PASS（无代码回归证据）**，按 Lead 裁决记为「跨会话环境漂移」，理由（已复核）：

1. **小地图默认关闭**：默认路径仅多一个组件模块 import 与 `{minimap && …}` 条件；`GraphMinimap` 不渲染、不创建 canvas/定时器，主画布 `drawNode`/连线/力导向路径完全没变。
2. **形态特征不符新增渲染分支**：若机器整体变慢，布局收敛 engineStop 应同比例变慢，但 engineStop 仅 **+1.7~1.8%**，而 firstTick +12~25%、mid/large fps **-30~38%**——属渲染/合成/计时环境变化；若新增分支执行会出现在小地图开启时，而 perf 场景为默认关闭。
3. **基线是 19 小时前另一会话**（10-30 23:18）；今天 19:03 浏览器/compositor/负载已变。QA 同会话 **4 次复跑形态一致**（机器负载 6–7%、Chrome CPU ~1%、无并发 dev/perf），说明这是当前环境的稳定值，不是偶发抖动。
4. **处置**：保留 phase6 与 phase7 两套数字，标注「待安静环境重基线」；不放宽任何代码门禁（默认关闭路径无渲染变化）。

> 注：`fixture` 与采样口径、脚本参数、Chrome channel 在两套数字中完全相同；两套数据分别保存在 `graph-baseline.phase6.run*.json` 与 `graph-baseline.phase7.run*.json`。

## 6. e2e 两次结果（如实记录）

- **首跑 18:53:57 exit 1**：`⨯ Another next dev server is already running … PID 22552` —— 并行流程的 dev server 占用 `.next` dev lock（环境冲突），非产品失败；日志 `phase7-qa-e2e-run1.log`。
- **重跑 18:54:00 exit 0**：**6/6 passed (8.1s)**；日志 `phase7-qa-e2e-run2.log`。
- 注：Lead 报告的首跑为「2 条冷编译 5s 超时」，与 QA 本次首跑原因不同（dev lock），均为 dev 环境抖动，不影响最终 6/6。

## 7. 观察项（非阻断）

1. 小地图点击/拖动只调 `centerAt`（zoom 不变、不重排、不请求），与 Lead 口径一致。
2. 8k 开启小地图时 longTask 峰值 400ms（一次性绘制点阵），未冻结；小地图默认关闭，不影响基线。
3. 性能基线：phase6（19h 前会话）与 phase7 数字均保留；**待安静环境时重跑一次基线**，后续阶段沿用同日新生效数字。若未来把「小地图」改为默认开启，需在同会话内做 minimap-on / off 的 A/B，再按 ±10% 判性能。

## 8. 产物清单

- 本报告：`artifacts/phase7-qa.md`
- 功能：`phase7-qa-verify.mjs` / `.json` / `.log`
- 截图：`phase7-qa-minimap-on.png`、`phase7-qa-minimap-jump.png`、`phase7-qa-minimap-mobile.png`、`phase7-qa-minimap-8k.png`
- 性能：`phase7-qa-perf-run1/2/3.log`、`phase7-qa-perf-retry1.log`、`graph-baseline.phase7.run1/2/3.json`、`graph-baseline.phase7.retry1.json`
- 静态/e2e：`phase7-qa-static.log`、`phase7-qa-build.log`、`phase7-qa-e2e-run1.log`、`phase7-qa-e2e-run2.log`

## 9. 任务状态

- **task-29 已完成（complete）**：功能与静态门禁全 PASS；性能按 Lead 裁决记「跨会话环境漂移（PASS，非代码回归）」，无 red 项。
- 环境收尾：3000/3001/3100/3102/3200 全 free；QA 启动的 dev server 已全部停止（完成时另有并行流程的 3300 dev server 在运行，非 QA 启动、不占本次门禁端口，未干预）；fixture 字节未变；`artifacts/` 未新建 `.tsx/.cjs`。
