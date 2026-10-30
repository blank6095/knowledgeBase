# 阶段 4（部分：U4-1/U4-2/U4-5）出口门禁验证（QA · phase4-qa）

- 记录人：qa-phase0
- 采集时间：2026-10-30 21:10 – 21:31（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（阶段 0/1/2/4 改动均未提交）
- 工具链：Node v22.20.0 / npm 10.9.3 / Playwright 1.64.1（`channel: chrome`）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`
- 范围：**U4-1 局部探索、U4-2 最短路径、U4-5 右键/长按菜单**；U4-3/U4-4 未做（待 UQ6/UQ7），阶段 3 仍阻塞于 UQ8

## 0. 结论表

| 门禁 / 检查点 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **PASS**（exit 0） | `phase4-qa-static.log` |
| `npm run lint` | **PASS**（exit 0，0 error / 0 warning） | `phase4-qa-static.log` |
| `npm test` | **PASS**（exit 0，39 文件 / **270 用例**；graph-focus 14） | `phase4-qa-static.log` |
| `npm run build` | **PASS**（exit 0，Compiled 1.4s，35 静态页，`/graph` ○ Static） | `phase4-qa-build.log` |
| `npm run test:e2e` | **PASS**（6 / 6，exit 0） | `phase4-qa-e2e.log` |
| U4-1 展开关联循环 + 邻居集合复算 + 调光 + 只改视图 | **PASS** | `phase4-qa-verify.json` |
| U4-2 直接/间接/无路径 + compare bar + 路径视觉 + 开关 + 不改数据 | **PASS** | 同上 |
| U4-5 右键菜单 7 项/disabled/键盘/动作/clamp/移动长按 | **PASS** | 同上 |
| 8k 二阶 focus + 路径激活（不崩、无冻结） | **PASS** | 同上 |
| 阶段 0–2 回归（搜索/详情/布局/导航/顶栏/图例/筛选/力/双选/拖拽/fixture/空态/骨架） | **PASS** | 同上 |
| 三档性能（同日 3 次中位数 vs phase2/phase0 ±10%） | **PASS** | §6 |
| **red 项** | **无** | — |

## 1. 命令明细

| # | 命令 | 时间 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 21:10:01 → 21:10:04 | 0 |
| 2 | `npm run lint` | 21:10:04 → 21:10:12 | 0（0 warning） |
| 3 | `npm test` | 21:10:12 → 21:10:1x | 0（39 文件 / 270 用例） |
| 4 | `npm run build` | 21:10:22 → 21:10:32 | 0 |
| 5 | `npm run test:e2e` | 21:10:32 → 21:10:44 | 0（6/6） |
| 6 | 功能验收脚本（dev 3102，20 项） | 21:26:13 → 21:27:5x | 0（20/20 PASS） |
| 7 | `perf:graph` run1/run2/run3 | 21:28:03 / 21:28:51 / 21:29:39 | 0 / 0 / 0 |

## 2. U4-1 局部探索（PASS）

| 检查点 | 实测 |
| --- | --- |
| 详情面板按钮循环 | `展开一阶关联(aria-pressed=false)` → `展开二阶关联(true)` → `收起关联(true)` → `展开一阶关联(false)` |
| 一阶/二阶邻居集合 | seed「TCP 与 UDP」（度 2）：一阶 **3/3**、二阶 **3/3** 与真实 `/api/graph` links 的 BFS 复算完全一致 |
| 非 focus 调光 | 一阶调光 12 个、二阶调光 12 个；像素比值法确认仅非 focus 节点被调暗（基准比为 1，非 focus ≤0.8），收起后全部恢复 |
| 只改视图 | 展开/收起前后 nodes=15、坐标快照 JSON、`__kbGraphEngineStop` 全部不变（无重排/无请求/未过滤数据） |
| 上限 300 | `collectNeighborIds` 的 maxNodes=300 稳定截断由 `graph-focus.test.ts` 14 条单测覆盖（含上限截断/去重/浅层优先），QA 代码审阅确认调用处传入 300 |

> 采样说明：节点中心像素是「节点 sprite ⊕ 连线」的复合 alpha（带连线的调光节点实测 0.6~0.67 而非 0.35），因此采用「focus 前后同点比值」分类（focus≈1.0、非 focus ≤0.8），避免把连线亮度误判为节点亮度。

截图：`phase4-qa-focus-1hop.png`、`phase4-qa-focus-2hop.png`。

## 3. U4-2 最短路径（PASS）

| 检查点 | 实测 |
| --- | --- |
| 直接路径 | 双选「OSI 七层模型 ↔ TCP 与 UDP」→ compare bar「路径：OSI 七层模型 → TCP 与 UDP（同文档）」，出现「清除路径」；路径节点 alpha≈1，非路径 **0.29**；路径边亮度 **106 → 169** |
| 间接路径 | 「概述 → 默认行为确实一样：都是单例 → 核心区别：多线程 vs 单线程（同文档 / 同文档）」，3 节点链 + 2 段关系类型均正确，中间节点 alpha=1.00 |
| 无路径 | 「TCP 与 UDP ↔ 概述」→「两个知识点之间没有路径」，且**无**「清除路径」开关 |
| 开关 | 「清除路径」→ 非路径节点恢复 1.00、按钮变「高亮路径」；再点「高亮路径」→ 非路径回 0.29 |
| 只改视图 | 前后 `/api/graph` 的 nodes 契约字段（除读取时现算的 `memory`）与 16 条 edges **完全一致**；节点坐标快照与 `engineStop` 不变 |
| 与 AI 解释共存 | 「解释关联」按钮保持可用（U4-3 AI 行为未改动，属未做范围，未触碰） |

截图：`phase4-qa-pathDirect.png`、`phase4-qa-pathIndirect.png`、`phase4-qa-pathNone.png`。

## 4. U4-5 右键 / 长按菜单（PASS）

| 检查点 | 实测 |
| --- | --- |
| 桌面右键 | 节点右键弹 `role=menu`；**7 项**：聚焦该节点 / 展开一阶关联 / 展开二阶关联 / 阅读知识点 / 编辑知识点 + 2 个 disabled（标记为重要、加入今日学习，带「需数据模型支持（当前未实现）」「需学习计划接口（U4-3 一并设计）」说明） |
| 键盘 | 打开聚焦首项；`↓`→展开一阶关联，`End`→编辑知识点，`Home`→聚焦该节点，`Enter` 执行；`Esc` 关闭 |
| 聚焦动作 | Enter「聚焦该节点」→ 节点居中 `dx=0.2 dy=0.2`，URL 保持 `/graph`，详情面板打开 |
| 展开动作 | 菜单「展开一阶关联」→ 面板按钮 `展开二阶关联`；「展开二阶关联」→ 面板按钮 `收起关联`（depth 写入正确） |
| 阅读/编辑 | 「编辑知识点」→ `/segments/<id>#edit` 且出现「✓ 完成编辑」；「阅读知识点」→ `/segments/<id>` |
| clamp | 锚点 x=977（视口 1440）打开菜单后把视口收窄到 600×500：菜单自动重夹为 `left=368 top=168 right=592 bottom=492`，四周 ≥8px，未越界 |
| 关闭 | 点击菜单外关闭；点击 disabled 项无反应（不关闭、不触发） |
| 移动端长按 | 375×812 下合成 `pointerdown(touch)` 500ms → 菜单可见；矩形 `8,265–232,636` 在视口内，无横向溢出，Esc 关闭 |

截图：`phase4-qa-context-menu.png`、`phase4-qa-menu-second-order.png`、`phase4-qa-mobile-menu.png`。

## 5. 8k fixture 激活 smoke + 回归

| 检查点 | 实测 |
| --- | --- |
| 8k 二阶激活 | 菜单「展开二阶关联」→ 激活窗口 1362ms（含 1.2s 观测窗；长任务 max **138ms**×4、最大帧间隔 **249ms**、续帧 84 次）→ 无冻结、canvas 存活、0 pageerror |
| 8k 路径激活 | 双选两节点 → 路径 BFS + 高亮呈现 **1252ms**（含密集图点击重试），路径文案可见，未崩溃 |
| 阶段 0–2 回归 | Ctrl+K 搜索「网络」3 条 + Esc；详情面板；沉浸布局（canvas 100%、sidebar/footer 隐藏、nav 7、顶栏、sr-only h1、图例）；设置四页签/筛选/暂停/4 力滑块；拖拽重排；`?fixture=graph-small` 500 节点；空态；骨架——全部 PASS |
| 控制台 | 主页面 pageerror=0、console.error=0（8k fixture 详情 404 为预期，已按白名单排除） |

## 6. 性能（同日 3 次，中位数）

phase2 中位（firstTick / engineStop / fps）：small 1006.9/1643.6/136.47；mid 1400.6/16533.5/4.345；large 1442.9/16493.2/2.635。
phase0 E：small 953/1586/135.3；mid 1409/16568/4.55；large 1457/16468/2.56。

| 指标 | phase2 中位 | run1 | run2 | run3 | **phase4 中位** | Δ vs phase2 | Δ vs phase0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small firstTick | 1006.9 | 974.7 | 999.3 | 1097.5 | **999.3** | -0.8% | +4.9% |
| small engineStop | 1643.6 | 1605.3 | 1686.2 | 1786.7 | **1686.2** | +2.6% | +6.3% |
| small fps | 136.47 | 134.21 | 130.70 | 135.73 | **134.21** | -1.7% | -0.8% |
| mid firstTick | 1400.6 | 1455.4 | 1415.8 | 1415.3 | **1415.8** | +1.1% | +0.5% |
| mid engineStop | 16533.5 | 16604.3 | 16566.3 | 16556.3 | **16566.3** | +0.2% | 0.0% |
| mid fps | 4.345 | 4.482 | 4.721 | 4.537 | **4.537** | +4.4% | -0.3% |
| large(实际 8000) firstTick | 1442.9 | 1471.3 | 1450.2 | 1500.2 | **1471.3** | +2.0% | +1.0% |
| large engineStop | 16493.2 | 16645.6 | 16448.3 | 16727.1 | **16645.6** | +0.9% | +1.1% |
| large fps | 2.635 | 2.448 | 2.429 | 2.428 | **2.429** | -7.8% | -5.1% |

**判定：三档 core 指标全部在 ±10% 内 → PASS**（对照 phase2 与 phase0 双基线均达标；默认态不激活 U4 绘制分支，符合预期）。
极值：small run3 的 firstTick 1097.5ms（+9.0% vs phase2）、engineStop 1786.7ms（+8.7%），仍 <10%；large fps 三次 2.428–2.449，稳定。
8k 激活性能量化见 §5（长任务 138ms、帧间隔 249ms，未见卡死）。

## 7. 观察项（非阻断）

1. **U4-3/U4-4 未做**：菜单里「标记为重要」「加入今日学习」是**如实占位**（disabled + 未实现说明），与 Lead 交付说明一致，不判缺陷；待 UQ6/UQ7。
2. 阶段 3 仍阻塞于 UQ8，本批未涉及主题系统；`外观主题` 导航项维持 disabled。
3. U4-2 的 `memory` 字段是 API 读取时现算（随时间变化），QA 对比「数据未被修改」时排除该派生字段，其余契约字段逐字节一致。
4. 8k 下 fixture 节点无对应 `/api/segments` 数据，展开关联会触发详情面板 error 态（404），属预期；focus/path 视觉仍正常。
5. 二阶 focus 在 15 节点库上二阶集合 = 一阶集合（seed 度 2、图小），属数据形态而非上限失效；300 上限由单测覆盖。

## 8. 产物清单

- 本报告：`artifacts/phase4-qa.md`
- 功能校验：`phase4-qa-verify.mjs`、`phase4-qa-verify.json`、`phase4-qa-verify.log`、诊断脚本 `phase4-qa-diag.mjs`
- 截图：`phase4-qa-focus-1hop.png`、`phase4-qa-focus-2hop.png`、`phase4-qa-pathDirect.png`、`phase4-qa-pathIndirect.png`、`phase4-qa-pathNone.png`、`phase4-qa-context-menu.png`、`phase4-qa-menu-second-order.png`、`phase4-qa-mobile-menu.png`
- 性能：`phase4-qa-perf-run1/2/3.log`、`graph-baseline.phase4.run1/2/3.json`
- 构建/静态/e2e 日志：`phase4-qa-build.log`、`phase4-qa-static.log`、`phase4-qa-e2e.log`
- 实现侧证据：`artifacts/phase4-lead-verify.md` / `.json`、`artifacts/u4-context-menu.md`

## 9. 任务状态

- **task-19 已完成（complete）**：U4-1/U4-2/U4-5 全部 PASS，无 red 项。
- 环境收尾：3000/3100/3102/3103/3200 全 free、0 个 node 进程；三个 fixture 字节未变；`artifacts/` 未新建 `.tsx/.cjs`。
