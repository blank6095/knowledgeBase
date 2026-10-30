# 阶段 2 出口门禁验证（QA · phase2-qa）

- 记录人：qa-phase0
- 采集时间：2026-10-30 20:39 – 20:50（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（阶段 0/1/2 改动均未提交）
- 工具链：Node v22.20.0 / npm 10.9.3 / Playwright 1.64.1（`channel: chrome`）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`
- 覆盖范围：U2-1 搜索索引、U2-2 搜索浮层、U2-3 四态视觉、U2-4 视口聚焦、U2-5 空态

## 0. 结论表

| 门禁 / 检查点 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **PASS**（exit 0） | `phase2-qa-static.log` |
| `npm run lint` | **PASS**（exit 0，0 error / 0 warning） | `phase2-qa-static.log` |
| `npm test` | **PASS**（exit 0，38 文件 / **256 用例**；graph-search 12 + search-visuals 5） | `phase2-qa-static.log` |
| `npm run build` | **PASS**（exit 0，Compiled 1.1s，35 静态页，`/graph` ○ Static） | `phase2-qa-build.log` |
| `npm run test:e2e` | **PASS**（6 / 6，exit 0） | `phase2-qa-e2e.log` |
| 搜索交互（Ctrl+K/焦点/↑↓/Enter/Esc/输入不请求） | **PASS** | `phase2-qa-verify.json` |
| 四态视觉（命中 1 / 邻居 0.75 / 无关 0.15） | **PASS**（受控图像素：1.00 / 0.87 / 0.15，见 §4 说明） | 同上 |
| 命中路径连线提亮 + 加粗 | **PASS**（受控 2 命中节点：均值亮度 64.2→126.4，像素数 215→245） | 同上 |
| 空态（「没有找到匹配知识」+ 图谱保留） | **PASS** | 同上 |
| U2-4 视口聚焦（250–400ms、dx=dy=0、无请求、engineStop 不变） | **PASS**（Enter 303ms / 点击 280ms） | 同上 |
| 搜索只改视图（坐标/节点数不变） | **PASS** | 同上 |
| 8k fixture：limit 8 不截断视觉 | **PASS**（可见 8 条，隐藏命中节点 alpha=1.00） | 同上 |
| 阶段 0/1 回归（布局/导航/顶栏/图例/详情/筛选/力/双选/空态/骨架） | **PASS** | 同上 |
| 移动端 375×812 搜索浮层 | **PASS**（left 12 / right 363 / width 351，无横向溢出） | 同上 |
| 三档性能（同日 3 次中位数，对照 phase0/phase1） | **PASS**（core 全部 ±10% 内） | §6 |
| 8k 搜索命中态帧率 | **PASS**（median 2.886fps，不劣于 phase1 large 2.419fps） | §6.3 |

## 1. 命令明细

| # | 命令 | 时间 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 20:39:57 → 20:40:00 | 0 |
| 2 | `npm run lint` | 20:40:00 → 20:40:08 | 0（0 warning） |
| 3 | `npm test` | 20:40:08 → 20:40:1x | 0（38 文件 / 256 用例） |
| 4 | `npm run build` | 20:40:18 → 20:40:29 | 0 |
| 5 | `npm run test:e2e` | 20:40:32 → 20:40:46 | 0（6/6） |
| 6 | 功能验收（dev 3102，18 项） | 20:44:43 → 20:45:15 | 0（18/18 PASS） |
| 7 | 8k 搜索命中态帧率（3 轮） | 20:45:47 → 20:46:10 | 0 |
| 8 | `perf:graph` run1/run2/run3 | 20:46:23 / 20:47:11 / 20:48:00 | 0 / 0 / 0 |

## 2. 搜索交互与 a11y（真实数据，15 节点）

| 检查点 | 实测 |
| --- | --- |
| Ctrl+K | 打开 `section[aria-label="搜索知识"]`，`document.activeElement` = `combobox[搜索知识]`；空查询 `aria-expanded=false`（设计），摘要「共 15 个知识点」 |
| 搜索「网络」 | **3 条真实结果**：HTTP 状态码 / OSI 七层模型 / TCP 与 UDP；每行「命中 · 标题/标签/摘要/路径（· detail）」；列表只展示标题 + 原因，无多余字段 |
| 输入期间网络 | **0 次** `/api/graph`、`/fixtures/*`、`/api/segments/*` 请求；`engineStop` 时间戳不变；节点 15 不变 |
| ↑ / ↓ | `aria-selected` 与 `aria-activedescendant` 同步切换（1 → 2 → 回到第 1 条） |
| Esc | 浮层关闭、查询清空；无关节点 alpha 由 0.15 恢复 **1.00**（全图恢复）；URL 保持 `/graph` |
| 空结果 | 输入 `zzzz不存在zzzz` → 「没有找到匹配知识」可见；canvas 仍在、节点 15 不变；`aria-expanded=false`（空结果设计） |
| 打开方式 | 顶栏搜索位点击同样打开浮层（`GraphTopBar(onSearchClick)` 接线） |

截图：`phase2-qa-desktop-search-open.png`、`phase2-qa-desktop-hit.png`、`phase2-qa-desktop-empty.png`。

## 3. U2-4 视口聚焦

| 检查点 | 实测 |
| --- | --- |
| Enter 聚焦（选中第 2 条） | 「OSI 七层模型」以 300ms 动画移动到画布中心 **(720, 500)**；`dx=0.0 / dy=0.0`；**耗时 303ms**（250–400ms 区间） |
| 点击结果聚焦 | 「TCP 与 UDP」**280ms** 到中心，`dx=1.0 / dy=0.4`；URL 仍 `/graph` |
| 聚焦期间 | **0 数据请求**，`__kbGraphEngineStop` 不变（未重排）；浮层保持打开（设计，便于继续切换结果） |

截图：`phase2-qa-desktop-focus.png`。

## 4. 四态视觉（U2-3）

- 受控 3 节点（1 命中 + 1 一阶邻居 + 1 无关，命中-邻居 1 条边）在 dev 页面内以真实渲染路径绘制，`getImageData` 采样节点中心 5×5 最大 alpha：
  - 命中 **1.00**（规范 1）
  - 一阶邻居 **0.87**（代码常量 0.75；像素为 canvas 复合值，节点光晕/连线在中心叠加后偏高，属绘制复合而非阈值偏离；三态梯次成立）
  - 无关 **0.15**（规范 0.15，与常量一致）
- 真实 15 节点数据上「网络」命中 3 个节点，其余节点明显淡化（截图 `phase2-qa-desktop-hit.png`），Esc 后恢复 1.00。
- 命中-命中连线（受控 2 节点、两端均命中「网络」）：连线区域亮度均值 **64.2 → 126.4（+97%）**，不透明像素数 **215 → 245（+14%）**；代码侧 `searchLinkBoost` 对命中路径额外 **1.8×** 线宽 + `shade(+0.35)` 提亮，采样到的 +14% 像素数受细线抗锯齿限制，提亮已明确成立。
- 命中外发光 ×1.7、放大 ×1.12 由代码审阅（`GraphCanvas` line 200-204）与 U2-3 的 5 条视觉纯函数单测覆盖。

截图：`phase2-qa-desktop-four-state.png`。

## 5. 8k fixture / 搜索只改视图 / 回归

| 检查点 | 实测 |
| --- | --- |
| 8k（实际 8000 节点）搜索「网络」 | 可见结果 **8 条**（limit 8）；状态栏「共 8000 个知识点」；取一个「命中但不在可见 8 条内」的节点采样 alpha=**1.00** → 证明绘制按全量 `matchedIds`，limit 只截断可见列表 |
| 匹配计数口径 | QA 按 fixture 标题复算 matched≈**705**（fixture 无 tags/summary/headingPath，仅标题参与）；Lead 记录 972 系其索引字段口径不同，不影响「limit 不截断视觉」结论（如需逐位对齐可加同一测量钩子） |
| 搜索只改视图 | 搜索进出前后：节点坐标快照 JSON 完全一致、engineStop 不变、nodes=15 未被过滤/删除 |
| 回归 | 搜索退出后单击节点打开详情面板（标题「TCP 与 UDP」）；沉浸布局 canvas 100%、sidebar/footer 隐藏、nav 7 项、顶栏、sr-only h1、图例展开/收起；设置面板四页签 + 筛选搜索 + 暂停 + 4 力滑块；双选 1/2 不跳页；空态/骨架；全部 PASS |
| 控制台 | pageerror=0、console.error=0 |

## 6. 性能

### 6.1 三档 `perf:graph`（同日 3 次，取中位数；对照 phase0/phase1 同环境基线）

phase0 E canonical（firstTick / engineStop / fps）：small 953/1586/135.3；mid 1409/16568/4.55；large 1457/16468/2.56。
phase1 三次中位数：small 997.7/1629.9/130.69；mid 1465/16633.1/4.137；large 1526.9/16823/2.419。

| 指标 | phase0 E | phase1 中位 | phase2 run1 | run2 | run3 | **phase2 中位** | Δ vs phase1 | Δ vs phase0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small firstTick | 953 | 997.7 | 1060 | 994.7 | 1006.9 | **1006.9** | +0.9% | +5.7% |
| small engineStop | 1586 | 1629.9 | 1692.8 | 1628.6 | 1643.6 | **1643.6** | +0.8% | +3.6% |
| small fps | 135.3 | 130.69 | 136.47 | 131.88 | 144.37 | **136.47** | +4.4% | +0.9% |
| mid firstTick | 1409 | 1465 | 1435.2 | 1400.6 | 1163.8 | **1400.6** | -4.4% | -0.6% |
| mid engineStop | 16568 | 16633.1 | 16533.5 | 16559.7 | 16279.2 | **16533.5** | -0.6% | -0.2% |
| mid fps | 4.55 | 4.137 | 4.265 | 4.345 | 5.541 | **4.345** | +5.0% | -4.5% |
| large firstTick | 1457 | 1526.9 | 1480.8 | 1442.9 | 1254.3 | **1442.9** | -5.5% | -1.0% |
| large engineStop | 16468 | 16823 | 16493.2 | 16689.3 | 16389 | **16493.2** | -2.0% | +0.2% |
| large fps | 2.56 | 2.419 | 2.313 | 2.635 | 3.172 | **2.635** | +8.9% | +2.9% |

**判定：三档 core 指标全部在 ±10% 内 → PASS**（对照 phase0 与 phase1 双基线均达标）。
极值记录：run3（20:48）整体最快（mid 5.54fps / large 3.17fps），run1 最慢（large 2.31fps），跨运行离散度 large fps 2.31–3.17、mid 4.27–5.54，属同日环境波动；中位数未劣化。

### 6.2 8k 搜索命中态帧率（新增绘制路径）

3 轮全新页面 `?fixture=graph-large`，firstTick 后打开搜索并输入「网络」（命中态 + 邻居 + 淡化分支全部生效），4s rAF 采样：

| 轮次 | fps | p95FrameMs | longTaskMax | 可见结果 |
| --- | --- | --- | --- | --- |
| 1 | 2.906 | 429.2 | 230 | 8 |
| 2 | 2.886 | 436.0 | 213 | 8 |
| 3 | 2.859 | 460.6 | 227 | 8 |
| **中位** | **2.886** | — | 230 | 8 |

对比：phase1 large 无搜索中位 **2.419fps** → 搜索命中态 **+19.3%**（未劣化）；phase0 E 2.56fps → **+12.7%**。8k 下输入到首条结果的往返为 467–536ms（含 Playwright `fill` 单次输入、React 提交与 8k 重绘；纯匹配 p95 1.31ms，见 §6.4）。

### 6.3 索引/匹配耗时（引用 U2-1 证据）

`artifacts/u2-search-index.md`：`buildSearchIndex(8000)` **3.73ms**；查询「网络」p95 **1.31ms**、max 7.08ms；无命中查询 p95 0.16–0.54ms —— 远低于 <50ms 口径；索引仅在 nodes 变更时重建一次。

## 7. 观察项（非阻断）

1. 邻居节点像素采样 0.87 vs 代码常量 0.75：canvas 中心像素是复合结果（光晕/连线叠加），三态梯次正确；如需精确断言常量级 alpha，可在绘制回调加测试钩子（例如 `window.__kbSearchAlpha`）。
2. 8k 下输入到首条结果 467–536ms：其中纯匹配 ≤1.31ms（U2-1 证据），其余为 8k 节点重绘 + React 提交；输入期间最长 long task 230ms，与阶段 1 的 large 布局期量级一致，未见新增卡顿源。
3. fixture「网络」matched 数：QA 按标题复算 705，Lead 记录 972，属索引字段口径差异（fixture 无 tags/summary/headingPath），不影响 limit 不截断视觉的验证结论。

## 8. 产物清单

- 本报告：`artifacts/phase2-qa.md`
- 功能校验：`phase2-qa-verify.mjs`、`phase2-qa-verify.json`、`phase2-qa-verify.log`
- 截图：`phase2-qa-desktop-search-open.png`、`phase2-qa-desktop-hit.png`、`phase2-qa-desktop-four-state.png`（含无关态）、`phase2-qa-desktop-empty.png`、`phase2-qa-desktop-focus.png`、`phase2-qa-mobile-search.png`
- 性能：`phase2-qa-perf-run1/2/3.log`、`graph-baseline.phase2.run1/2/3.json`、`phase2-qa-perf-search.mjs` / `.log` / `.json`
- 构建/静态/e2e 日志：`phase2-qa-build.log`、`phase2-qa-static.log`、`phase2-qa-e2e.log`
- 引用证据：`artifacts/u2-search-index.md`（索引/匹配耗时）、`artifacts/phase2-lead-verify.md`（实现侧验收）

## 9. 任务状态

- **task-15 已完成（complete）**；阶段 2 全部检查点 PASS。
- 环境收尾：3000/3100/3102/3200 全 free、无残留 node 进程；三个 fixture 字节/mtime 未变；`artifacts/` 未新建 `.tsx/.cjs`。
