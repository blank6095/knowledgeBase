# T01 全站前端质量审计报告

## 结论摘要

- 已确认缺陷 **17 项**：P0 **0**、P1 **2**、P2 **8**、P3 **7**。
- 没有发现可证实的数据损坏、安全或全站不可用级问题（P0）；但设置页存在一条**条件触发的数据丢失路径**（FE-001），按最高紧急度处理。
- 最该先修的三项：
  1. **FE-001 设置页配置读取失败仍允许保存**：会把模型重置为默认值，并提交空的学习者自述，清空已存内容。
  2. **FE-003 `/graph` 的 Ctrl+K 快捷键完全无效**：搜索按钮上明示该快捷键，但组件在关闭态被卸载，监听器不存在。
  3. **FE-004 + FE-005 设置页配置回填竞态与保存/测试并发**：与 FE-001 同一文件、同一生命周期，适合与 FE-001 一起修完。
- FE-002（大图性能）是独立批次：5,000 / 8,000 节点下首次布局约 16 秒，期间 6.2 / 3.6 fps，低于项目文档中的 45 / 30 fps 目标；需要单独排期与回归基线。

---

## 审计环境与数据

| 项 | 值 |
|---|---|
| 审计时间 | 2026-11-03（Asia/Shanghai） |
| 仓库 | `d:\20-Work\knowledgeBase`，保留全部未提交改动，未执行 git add/commit/stash/checkout/reset |
| Next.js | 16.4.3（`package.json` 实值）；已核对 `node_modules/next/dist/docs/`，本次问题均在客户端交互、样式与请求生命周期层，未使用旧版本 API 结论 |
| Node / 浏览器 | Node v22.20.0；Chrome 156.0.8078.74（Playwright `channel: chrome`，headless） |
| 视口 | 桌面 1440×900；移动 390×844、375×667、320×720（DPR 2、`isMobile` + `hasTouch`） |
| 服务 | `npm run dev -- --hostname 127.0.0.1 --port 3100` |
| 数据来源 | 真实 Neon Postgres：4 篇文档、图谱 15 节点 / 16 边；本地夹具 `graph-small` 500/1,489、`graph-mid` 5,000/20,753、`graph-large` 8,000/33,005 |
| 鉴权 | 从 `.env.local` 运行时读取访问口令；未把口令、连接串或密钥写入报告、证据 JSON 或截图（设置页 Key 区域已打码，JSON 中的尾号已脱敏） |

**审计副作用（如实记录）**：早期一次未安装路由拦截的设置页操作，真实触发了 1 次 `/api/settings` 保存与 1 次 `/api/ai/test`。提交值（模型、Key 留空、学习者自述）与当时已有配置相同，未改变业务数据值，但会更新记录的 `updatedAt`，并在用量日志中新增 1 次调用。此后所有写操作（导入、复习、PATCH、设置、AI 请求）均使用 `page.route` 返回模拟响应，未落库。

**无法覆盖**：20,000 节点压测（实际 `graph-large` 只有 8,000 节点，与历史文档标注的 20,000 不一致）、Safari/iOS 真机、真实触屏长按、真实 LLM 请求与动作执行、标注创建全流程。

---

## 1. 全站页面审计覆盖表

图例：**无问题** = 已实操且未发现缺陷；**有缺陷** = 见括号内编号；**待验证** = 已尝试，但缺前提或未走完整路径。

| 页面 | 布局 | 交互 | 数据/接口 | 加载/空/错误三态 | 移动端 | 代码质量/性能 |
|---|---|---|---|---|---|---|
| `/` | 无问题 | 无问题 | 无问题（stats 失败→错误+重试） | 无问题 | 无问题（320/375/390 无横向溢出） | 无问题 |
| `/graph` | 无问题 | 有缺陷（FE-003） | 无问题（graph 失败→“图谱没能加载”+重新加载） | 无问题（筛选空态+重置可用） | 有缺陷（FE-006） | 有缺陷（FE-002、FE-009） |
| `/notes` | 无问题 | 无问题（搜索/无结果/清空恢复） | 无问题（断网→错误+重试恢复） | 无问题 | 有缺陷（FE-015） | 无问题 |
| `/notes/[id]` | 有缺陷（FE-013） | 待验证（标注创建） | 无问题（详情失败→错误+重试） | 无问题 | 有缺陷（FE-013、FE-014、FE-007） | 有缺陷（重复编辑组件） |
| `/segments/[id]` | 无问题 | 无问题（编辑/取消/保存失败回显） | 有缺陷（FE-010） | 无问题 | 有缺陷（FE-007） | 有缺陷（重复编辑组件） |
| `/study/[segmentId]` | 无问题 | 有缺陷（FE-012） | 无问题（题目失败→错误+重新生成） | 无问题 | 无问题 | 无问题 |
| `/progress` | 无问题 | 待验证（日期格点击/预览） | 无问题（weekly 失败→错误+重试） | 无问题 | 无问题（热力格 44×56） | 无问题 |
| `/ask` | 无问题 | 无问题（单飞、失败保留输入、重试） | 有缺陷（FE-008） | 待验证（配置失败态） | 无问题（发送按钮空输入禁用） | 有缺陷（两套渲染路径） |
| `/import` | 无问题 | 无问题（类型校验、单飞、成功态） | 无问题（POST 失败→错误） | 无问题 | 有缺陷（FE-007 粒度按钮 41px） | 无问题 |
| `/settings` | 无问题 | 有缺陷（FE-004、FE-005） | 有缺陷（FE-001） | 有缺陷（配置读取失败无错误态） | 有缺陷（FE-007） | 有缺陷（配置生命周期无脏标记） |
| `/login` | 无问题 | 无问题（空口令禁用、错误口令提示、401 跳转） | 无问题 | 无问题 | 无问题 | 无问题 |

---

## 2. 已确认缺陷清单（按优先级汇总）

| 编号 | 优先级 | 页面 | 缺陷 | 位置 |
|---|---|---|---|---|
| FE-001 | P1（潜在数据丢失） | `/settings` | 配置读取失败时表单仍可保存，重置模型并清空学习者自述 | `src/app/settings/page.tsx:89-126`、`src/app/api/settings/route.ts:25-26,45-46` |
| FE-002 | P1（大数据量） | `/graph` | 5,000/8,000 节点布局期 16s、6.2/3.6fps，低于项目目标 | `src/components/graph/GraphCanvas.tsx:491-520` |
| FE-003 | P2 | `/graph` | Ctrl+K 搜索快捷键无效 | `GraphTopBar.tsx:71-91`、`GraphSearch.tsx:100-118`、`KnowledgeUniverse.tsx:1381` |
| FE-004 | P2 | `/settings` | 初始配置异步回填覆盖用户刚做的选择 | `src/app/settings/page.tsx:89-109` |
| FE-005 | P2 | `/settings` | 保存与测试可并发，反馈互相覆盖 | `src/app/settings/page.tsx:111-170,271-282` |
| FE-006 | P2 | `/graph` 移动端 | 设置面板 6 个标签被压成 38×48，逐字换行 | `KnowledgeUniverse.tsx:1091-1101` |
| FE-007 | P2 | 移动端多页 | 多个独立按钮触控目标小于 44×44 | 见缺陷详情 |
| FE-008 | P2 | `/ask` | 配置接口失败被误判为“还没有配置大模型” | `src/app/ask/page.tsx:136-140,470` |
| FE-009 | P2 | `/graph` | 详情面板加载/失败时标题一直显示“加载中…”，失败也不恢复节点名 | `GraphDetailPanel.tsx:81-88` |
| FE-010 | P2 | `/segments/[id]` | 详情接口 536-550ms（冷启 1060ms），比笔记详情慢 20-30 倍 | `src/app/api/segments/[id]/route.ts:33-82` |
| FE-011 | P3 | 全站错误态 | 直接展示浏览器原文 “Failed to fetch” | `src/components/ErrorState.tsx:32` 及各调用点 |
| FE-012 | P3 | `/study/[segmentId]` | 结果按钮快速双击发出 2 次 POST（服务端按 `submissionId` 幂等） | `src/app/study/[segmentId]/page.tsx:118-131` |
| FE-013 | P3 | `/notes/[id]` 移动端 | 代码块右侧被裁切，无横向滚动提示 | `src/app/globals.css:261-270` |
| FE-014 | P3 | `/notes/[id]` 移动端 | 目录浮层无显式关闭按钮，只能点外部或 Esc | `src/app/notes/[id]/page.tsx:959-972` |
| FE-015 | P3 | `/notes` 移动端 | 文档标签在窄屏被隐藏，失去标签筛选上下文 | `src/app/notes/page.tsx:124` |
| FE-016 | P3 | 全站 | 内容容器在 42rem / 2xl / 3xl / 4xl 四档间跳变 | `ask:371,625`、`notes:63`、`progress:90`、`import:142`、`settings:182`、`study:253` |
| FE-017 | P3 | 移动端 | 底部仍展示 “Ctrl K” 快捷键提示 | `src/components/AppShell.tsx:95-100` |

---

## 3. 缺陷详情

### FE-001 设置页配置读取失败仍允许保存，导致模型被重置、学习者自述被清空

- **位置**：`src/app/settings/page.tsx:89-109`（加载与 `catch` 设置 `configured:false`）、`src/app/settings/page.tsx:111-126`（保存请求体始终提交 `learnerDeclaration`）、`src/app/api/settings/route.ts:25-26`（`model` 空则回退 `DEFAULT_MODEL`）、`src/app/api/settings/route.ts:45-46`（保存 `''` 自述）。
- **问题**：`/api/ai/config` 失败时，页面把 `config` 置为未配置，但表单仍以默认值渲染且“保存”可用，没有任何错误提示。用户此时保存，会把主模型改回默认，并把空字符串写入 `learner_declaration`。
- **复现步骤**：
  1. 登录后拦截并中止 `GET /api/ai/config`。
  2. 打开 `/settings`，等待 1s。观察：无错误提示，模型显示 `deepseek-v4-flash（默认）`，学习者自述为空，“保存”按钮可点击。
  3. （为避免真实写库，本次未点击保存）按 `route.ts` 逻辑，提交体包含 `model=deepseek-v4-flash`、`learnerDeclaration=''`，服务端会执行对应更新。
- **预期**：配置未成功读取时，应显示错误并提供重试，禁止保存。
- **实际**：错误被吞掉，表单以“空配置”可编辑可保存。
- **根因**：配置加载失败与“确实未配置”共用同一状态；表单没有 `loaded` 闸门，也没有脏标记；保存请求把内存中的默认值当作完整配置提交。
- **证据**：`flow-settings-config-load-failure.png`；DOM 断言 `saveDisabled=false`、`declarationValue=''`、`modelValue='deepseek-v4-flash'`；`route.ts` 代码。
- **影响范围**：所有在配置读取失败（网络抖动、Neon 超时、服务端 5xx）时进入设置页并保存的用户；属于静默数据丢失。
- **优先级**：P1。若线上发生即为数据损坏，建议按最高紧急度排期。
- **推荐修复**：引入 `configLoadState: loading | ready | failed`；`failed` 时渲染错误块 + “重新加载”，隐藏/禁用表单；保存前要求 `ready`；提交只发送用户实际修改过的字段（PATCH 语义），未加载成功前不得发送 `learnerDeclaration`。
- **验收**：中止 `/api/ai/config` → 页面显示“配置读取失败”与重试按钮，保存按钮 `disabled`；恢复接口后重试成功，表单回填原值；正常保存只提交改动字段。

### FE-002 大图布局期性能不足（5,000 / 8,000 节点）

- **位置**：`src/components/graph/GraphCanvas.tsx:491-520`（仅设置 `warmupTicks` / `d3AlphaMin`，未设置 `cooldownTicks` / `cooldownTime` / 降采样；每帧全量绘制节点与边）；`GraphMinimap.tsx:35-100` 每 350ms 重绘小地图。
- **数据与测量**（1440×900，headless Chrome；`requestAnimationFrame` 采样 2.5s，`PerformanceObserver` 记录 longtask）：

| 夹具 | 节点/边 | 首次 tick | 力导向停止 | 布局期 fps | 帧间隔 p95 | >50ms longtask | 稳定后缩放两帧耗时 |
|---|---|---|---|---|---|---|---|
| 真实库 | 15 / 16 | 1214ms | 1867ms（0.65s） | 144 | 7.2ms | 0 | — |
| graph-small | 500 / 1,489 | 931ms | 1563ms（0.63s） | 144 | 7.2ms | 0 | — |
| graph-mid | 5,000 / 20,753 | 1064ms | 16045ms（16.0s） | **6.2** | 180.6ms | 23 条，最大 168ms | 63.8ms / 2 帧 |
| graph-large | 8,000 / 33,005 | 1111ms | 16229ms（16.2s） | **3.6** | 326.3ms | 56 条，最大 171ms | 80.5ms / 2 帧 |

  移动端 390×844：5,000 节点同样 16.2s 停止，23 条 longtask（最大 163ms）。
- **复现**：`/graph?fixture=graph-mid`（或 `graph-large`），在首屏 2.5s 内采样 rAF；或运行仓库 `scripts/measure-graph.mjs`。
- **预期**：项目历史文档给出的目标是 500 节点 ≥55fps、5,000 ≥45fps、20,000 ≥30fps；交互（拖拽/缩放）应保持可感知流畅。
- **实际**：首次布局约 16s 内只有 3.6-6.2fps；稳定后缩放两帧耗时 64-81ms（约 25-31fps），未达目标。
- **根因**：力导向模拟默认冷却周期长（未显式 `cooldownTicks`/`cooldownTime`），冷却期每帧全量绘制 2-3 万条边与 5-8 千节点；无按缩放级别的标签/边降采样，主线程 longtask 最大 171ms。
- **证据**：`graph-deep.json`、`graph-results.json`、`perf-graph-*.png`、`final-checks.json`。
- **影响范围**：累积到 5,000+ 知识点的重用户；真实库 15 节点不受影响。
- **优先级**：P1（仅大数据量场景）。历史文档已承认未达 45/30fps，因此属于“已知未完成项”，但当前代码仍未闭环。
- **推荐修复**：显式设置 `cooldownTicks`（如 250-400）、`cooldownTime` 与更高的 `d3AlphaDecay`；按节点数分级关闭标签/光晕/边箭头；边数 >10k 时改为低透明度单像素线并抽稀；小地图降频或暂停；必要时把力布局放入 Worker（需评估依赖，不在本批次引入）。先固化 500/5,000/8,000 三档基线再改。
- **验收**：`graph-mid` 布局期 ≥30fps、停止时间 <8s、无 >100ms longtask；`graph-large` 停止时间 <12s；缩放两帧 <40ms（桌面）；结果记录进 `docs/plans/frontend-quality-audit-evidence/`。

### FE-003 `/graph` 的 Ctrl+K 完全无效

- **位置**：`GraphTopBar.tsx:71-91` 仅在 `searchOpen === true` 时渲染 `searchOverlay`；`GraphSearch.tsx:100-118` 的全局 keydown 监听写在组件内部，并注明“监听常驻（open=false 时仍可唤起），因此不能随浮层一起卸载”；`KnowledgeUniverse.tsx:1381` 以 prop 形式传入 `<GraphSearch open={searchOpen}>`。
- **问题**：关闭态下 `GraphTopBar` 不渲染该元素，React 因此不会挂载 `GraphSearch`，其 document 监听不存在。按钮上却显示 “Ctrl K”。
- **复现**：
  1. 打开 `/graph`，等画布就绪。
  2. 按 `Ctrl+K`；再执行 `document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`。
  3. 两种方式均没有出现搜索输入框；点击顶部“搜索知识（Ctrl K）”按钮则正常打开。
- **证据**：`flow-graph-ctrl-k.png`、`flow-graph-ctrl-k-synthetic.png`；`flow-deep.json` 中 `realKeyOpened=false`、`syntheticOpened=false`。
- **影响**：键盘用户无法从图谱页唤起搜索；与可见提示不一致。
- **优先级**：P2。
- **推荐修复**：把 keydown 监听上移到 `KnowledgeUniverse`（始终挂载），或让 `GraphTopBar` 无条件渲染 `GraphSearch`（内部用 `open` 控制显示/隐藏）；保留 Esc 关闭。
- **验收**：`/graph` 下 `press('Control+K')` → `combobox[aria-label="搜索知识"]` 可见；输入后 Enter 打开详情；Esc 关闭并归还焦点。

### FE-004 设置页异步配置回填覆盖用户刚做的选择

- **位置**：`src/app/settings/page.tsx:89-109`（`api('/api/ai/config')` 完成后无条件 `applyConfig`）。
- **问题**：表单在配置返回前已可交互；`applyConfig` 会重置 `modelChoice`、`fastChoice`、`declaration`，用户先选“自定义”会被打回默认。
- **复现**：打开 `/settings` 后立即把主模型切到“自定义…”（不等待加载）。观察：模型选择回退为默认，自定义模型 id 输入不出现；此时点保存，请求使用默认模型（本次用 mock 记录到 1 次 POST）。
- **对照**：等待出现“已保存（尾号 ****）”后再切换自定义，输入框正常出现；直接保存会命中本地校验“模型选「自定义」时必须填写模型 id，已取消保存”。
- **证据**：`flow-settings-custom-validation.png`（回退后保存默认模型）、`flow-settings-race-after-load.png`（等待加载后正常）、`interaction-results.json`。
- **影响**：快速操作的用户会丢失模型选择，保存出非预期的配置。
- **优先级**：P2（与 FE-001 同根因，但未造成已存数据丢失）。
- **推荐修复**：与 FE-001 同批：`ready` 前禁用/隐藏表单；或记录 `dirty`，`applyConfig` 只在未发生用户编辑时执行；异步请求加取消标记。
- **验收**：页面挂载后 100ms 内切换自定义 → 选择保持、输入出现；配置响应到达后不回滚；保存请求体为自定义模型。

### FE-005 保存与测试可并发，反馈互斥失效

- **位置**：`src/app/settings/page.tsx:111-170`（`handleSave` / `handleTest` 各自独立 `saving`、`testing`）、`:271-282`（两个按钮只按各自 busy 禁用）。文件内注释写明“保存/测试/校验互斥”，实现未落实。
- **复现**：打开 `/settings`，点击“保存”，150ms 内点击“测试当前输入”（两者均用 1.5s 延迟 mock）。观察：两个按钮同时显示“保存中…”与“测试中…”，最终只保留最后完成的一条反馈。
- **证据**：`flow-settings-concurrent.png`；`graph-results.json` 中 `settingsPosts=1`、`testPosts=1`、`bothBusyAtOnce=true`。
- **影响**：测试可能使用尚未保存的输入，用户无法判断哪条反馈对应哪次操作；弱网下容易重复点击。
- **优先级**：P2。
- **推荐修复**：单一 `busy: 'saving' | 'testing' | null`，任一进行中同时禁用两个按钮；保存/测试反馈分区展示，不共享同一条消息位置。
- **验收**：保存进行中“测试”按钮 `disabled`；两者反馈可同时存在且各自对应操作；双击不产生第二次请求。

### FE-006 移动端图谱设置面板标签逐字换行

- **位置**：`KnowledgeUniverse.tsx:1091-1101`（6 个 `flex-1 px-2` 标签，放在 300px 面板内，未设 `whitespace-nowrap` / `shrink-0`）。
- **实测**：375×667 与 390×844 下，每个标签宽 **38px、高 48px**，中文被压成两行（“筛/选”“分/组”“显/示”）；面板本身 `overflow-y:auto`，关闭按钮 32×32 未被底部导航遮挡（375 下底边 587，导航顶 597）。
- **证据**：`flow-map-panel-375x667.png`、`flow-map-panel-320x720.png`、`final-checks.json`。
- **影响**：核心筛选/主题入口可读性差，视觉上像排版错误。
- **优先级**：P2。
- **推荐修复**：标签容器改为横向可滚动（`overflow-x-auto` + `whitespace-nowrap` + `shrink-0`），或改成两行网格/图标 + 短标签；保持关闭按钮固定。
- **验收**：320/375/390 宽度下每个标签单行，面板仍可在 300px 内滚动且关闭按钮可见。

### FE-007 移动端多个独立按钮触控目标小于 44×44

- **位置与实测**（390×844，仅列独立可点击控件；行内文本链接不计）：
  - `/notes/[id]`：`✎＋` 33×18（`notes/[id]/page.tsx:1149-1157`）、`✎ 编辑` 67×32。
  - `/segments/[id]`：`开始复习` 74×30、`✎ 编辑` 67×32。
  - `/ask`：3 个推荐问题 chip 127-139×28（`ask/page.tsx` 推荐区）；发送按钮 62×43（接近阈值）。
  - `/settings`：`保存` 58×32、`测试当前输入` 112×34（`settings/page.tsx:271-282`）。
  - `/import`：粗/标准/细粒度 105×41。
  - `/`：`导入知识` 88×37；文档行 326×41。
- **证据**：`touch-targets.json`。
- **影响**：单手操作误触；`✎＋` 18px 高度在手机上几乎无法稳定点中；不符合 iOS 44pt / WCAG 2.5.8 推荐。
- **优先级**：P2。
- **推荐修复**：独立按钮统一 `min-h-11 min-w-11`（44px）或增加透明命中层；行内 `✎＋` 改为 32px 图标按钮并保留 hover 显示；chip/保存/粒度按钮提高高度到 44px。
- **验收**：同一脚本重跑 `touch-targets.json`，独立按钮中不存在 `<32px` 的项；`✎＋`、保存、测试、chip 均 ≥44px 高。

### FE-008 `/ask` 配置读取失败被误判为未配置

- **位置**：`src/app/ask/page.tsx:136-140`（`api('/api/ai/config').catch(() => setConfigured(false))`）、`:470`（`configured === false` 渲染“还没有配置大模型” + 去设置）。
- **问题**：网络/数据库瞬时失败与“确实没有 Key”共用 `configured:false`。
- **复现**：拦截并中止 `GET /api/ai/config`，打开 `/ask`。页面直接显示“还没有配置大模型…去设置”，没有错误提示或重试。
- **证据**：`flow-error-_ask.png`；`graph-results.json` 中 `error-ask-config` 文本。
- **影响**：已配置用户被引导去重新配置；真实故障被掩盖。
- **优先级**：P2。
- **推荐修复**：区分 `error` 与 `configured:false`；失败时显示“无法读取配置”+ 重试，保留输入区禁用状态说明；仅在服务端明确返回未配置时展示设置引导。
- **验收**：中止 config → 显示错误 + 重试，不出现“去设置”；恢复后重试进入正常对话。

### FE-009 图谱详情面板标题在加载/失败时停留在“加载中…”

- **位置**：`GraphDetailPanel.tsx:81-88`：`status==='loading' || status==='error'` 都渲染 `加载中…`，即使已持有节点标题也不使用。
- **复现**：在图谱搜索打开节点详情，正常网络下 700ms 内标题仍是“加载中…”；中止 `/api/segments/*` 后，面板正文显示“Failed to fetch”+重试，但标题仍是“加载中…”。
- **证据**：`flow-graph-detail-panel.png`、`flow-graph-detail-error.png`（面板文本：`知识点 | 加载中… | ✕ | Failed to fetch | 重试`）。
- **影响**：用户不知道打开了哪个节点；失败态语义矛盾。
- **优先级**：P2（与 FE-010 叠加后更明显）。
- **推荐修复**：面板挂载即用图节点的 `title/type` 渲染标题；加载态只替换正文骨架；错误态标题显示节点名并展示错误块。
- **验收**：点击节点后首帧标题即为节点标题；断网时标题正确、正文有重试。

### FE-010 `/segments/[id]` 详情接口显著偏慢

- **位置**：`src/app/api/segments/[id]/route.ts:33-82`（`q1` 取 segment，再串行 `q2` 取文档标题 + 邻居；`Server-Timing` 显示两段各约 260ms）。
- **实测**（真实库，4 次）：`/api/notes` 17-18ms、`/api/notes/[id]` 17-33ms、`/api/graph` 15-18ms、`/api/segments/[id]` **536/541/550ms**，冷启 **1060ms**。
- **证据**：`api-latency.json`；冷启时桌面首屏 2.5s 仍是骨架（`desktop-segment-detail.png`）。
- **影响**：从笔记/图谱进入知识点详情的等待明显；详情面板（FE-009）也受此拖累。
- **优先级**：P2（性能体验；非故障）。
- **推荐修复**：把文档标题并入 `q1` 的 join，减少一次串行往返；对只读详情加缓存（按 segment 版本/更新时间失效），PATCH/删除/导入后主动失效；不要缓存跨用户敏感字段。
- **验收**：warm p50 <200ms、p95 <350ms；详情页骨架 <300ms；PATCH 后立即刷新能拿到新内容。

### FE-011 错误态暴露浏览器原文 “Failed to fetch”

- **位置**：`src/components/ErrorState.tsx:32` 直接渲染传入 `message`；各页面把 `err.message` 原样传入（`/`、`/progress`、`/notes/[id]`、`/segments/[id]`、`/study`、`/graph`）。
- **复现**：对任一数据接口 `route.abort()`，错误卡片首行均为英文 `Failed to fetch`，下方才是中文建议。
- **证据**：`flow-error-*.png`、`graph-results.json` 各 `error-*` 文本。
- **影响**：中文产品出现技术英文原文；用户无法区分断网、服务端错误与鉴权失败。
- **优先级**：P3。
- **推荐修复**：在 `lib/client.ts` 的 `api()` 中统一映射：`TypeError`→“网络连接失败，请检查网络后重试”；5xx→“服务暂时不可用”；401→“登录已失效”；原始信息仅放折叠的“详情”或控制台。
- **验收**：断网/500/401 三种场景均只显示中文可行动文案，不出现 `Failed to fetch`。

### FE-012 学习结果快速双击产生 2 次复习请求

- **位置**：`src/app/study/[segmentId]/page.tsx:118-131`（`if (saving) return` 依赖 state；React 提交前第二次点击仍读到旧闭包），结果按钮使用 `disabled={busy===...}`。
- **复现**：填写答案 → 查看参考答案 → 1.5s 延迟 mock 下快速双击“答对了”。网络面板/计数为 **2 次 POST**。
- **数据安全**：`src/app/api/learning/reviews/route.ts` 以 `submissionId` 去重，第二次返回 `duplicate:true`，不会重复写复习记录；因此非数据缺陷。
- **证据**：`flows-deep.json` 中 `study.requests=2`。
- **影响**：多余请求、按钮状态闪烁；弱网下用户会以为未提交。
- **优先级**：P3。
- **推荐修复**：`useRef` 同步闸门（进入即置 true，finally 释放），并同步设置 `disabled`；提交成功后禁用整组按钮直到跳转。
- **验收**：连续两次点击/Enter → 仅 1 次请求；失败后闸门释放可重试。

### FE-013 移动端代码块右侧裁切且无滚动提示

- **位置**：`src/app/globals.css:261-270`（`.md-body pre { overflow-x:auto }`）；笔记详情正文。
- **实测**：390 宽度下代码行右边界超出容器（DOM `right≈606`），`pre` 内部可横向滚动，但页面无溢出；截图上最右侧代码被切断且无渐隐/滚动条提示。
- **证据**：`mobile-note-detail.png`。
- **影响**：用户误以为内容缺失；横向滚动不易发现。
- **优先级**：P3。
- **推荐修复**：给 `pre` 增加右侧渐隐遮罩或“可横向滚动”提示；或移动端改为软换行（保留复制按钮）。
- **验收**：390/320 下代码块有可见滚动提示，或长行完整换行。

### FE-014 移动端目录浮层无显式关闭按钮

- **位置**：`src/app/notes/[id]/page.tsx:959-972`（`role="dialog"` 目录面板，仅点击遮罩或 Esc 关闭）。
- **证据**：`flow-mobile-toc.png`；打开后焦点进入面板（`focusedInside=true`），Esc 可关闭。
- **影响**：触屏用户不知道如何关闭；缺少与桌面一致的关闭图标。
- **优先级**：P3。
- **推荐修复**：在面板右上角加 44×44 关闭按钮，保留点击外部/Esc。
- **验收**：面板内存在 `aria-label="关闭目录"` 按钮，点击后关闭；焦点回到触发按钮。

### FE-015 移动端笔记列表隐藏标签

- **位置**：`src/app/notes/page.tsx:124` 标签使用 `hidden sm:inline`。
- **证据**：`desktop-notes.png` 有标签、`mobile-notes.png` 无标签。
- **影响**：手机端无法从列表判断文档主题/标签，也无法利用标签信息决定打开哪篇。
- **优先级**：P3。
- **推荐修复**：窄屏保留 1-2 个标签（`max-w` + 截断）或折叠为“标签数 +1”。
- **验收**：390 宽度下列表项至少显示 1 个标签或标签摘要，且不换行溢出。

### FE-016 内容容器宽度不统一

- **位置**：`ask/page.tsx:371,625`（42rem）、`notes/[id]/page.tsx:890`（42rem）、`segments/[id]/page.tsx:240`（42rem）、`notes/page.tsx:63`（4xl=56rem）、`progress/page.tsx:90`（4xl）、`import/page.tsx:142`（3xl=48rem）、`settings/page.tsx:182`、`study/[segmentId]/page.tsx:253`（2xl=42rem）。
- **影响**：从 896px 列表页跳到 672px 详情页时内容左边缘横移；同类表单/阅读页宽度不一致，视觉体系不稳定。
- **优先级**：P3（视觉一致性/技术债）。
- **推荐修复**：定义 2-3 个布局 token（如 `reading` 42rem、`list` 56rem、`form` 48rem），在 layout 级统一。
- **验收**：同一类页面在 1440 下左边缘一致；设计走查无跳变。

### FE-017 移动端仍展示 Ctrl K 提示

- **位置**：`src/components/AppShell.tsx:95-100` 底部“全库检索 Ctrl K”在移动端同样渲染（`md:` 隐藏规则只作用于布局，不作用于 `kbd`）。
- **证据**：`mobile-ask.png`、`flow-graph-ctrl-k.png` 底部提示。
- **影响**：触屏设备无 Ctrl 键，提示误导；占用底部空间。
- **优先级**：P3。
- **推荐修复**：`kbd` 使用 `hidden md:inline`；移动端保留“搜索”文案或改为图标。
- **验收**：390 宽度下底部不出现 `Ctrl K`。

---

## 4. 待验证问题清单（含缺失前提）

| # | 问题 | 已尝试 | 缺失前提 |
|---|---|---|---|
| 1 | 笔记划词标注创建/删除全流程 | 只验证了编辑模式、目录、错误态 | 需用 Selection API 精确选择跨节点文本并处理浮动菜单位置；未写入真实标注 |
| 2 | 图谱移动端长按菜单、双指缩放、节点拖拽 | 只验证点击、筛选、双选、详情 | Playwright 未模拟真实长按（500ms+位移阈值）与多指手势；需真机或 CDP touch 注入 |
| 3 | 20,000 节点性能与 50,000 节点平移目标 | 仅测到 8,000 | `public/fixtures/graph-large.json` 实际 8,000 节点，历史文档写 20,000；缺 20k/50k 夹具 |
| 4 | 设置页真实保存 Key / 自定义模型成功链路 | 仅用 mock 验证本地校验与并发 | 需真实写库并验证回显/Key 尾号，本次刻意避免 |
| 5 | 导入“语义”粒度与 LLM 失败回退 | 只测“标准”粒度的校验/单飞/错误/成功 | 语义粒度会调用真实模型；未测失败自动回退后的 UI |
| 6 | 问知识库的动作执行（改标题、整理段落、追加笔记） | 仅验证 SSE 文本流、来源、错误重试 | 需点击动作按钮并写入知识库；本次用 mock 避免副作用 |
| 7 | 复盘热力图日期点击/预览、跨周滚动 | 仅截图与错误态 | 需点击具体日期并断言预览内容；未验证滚动到最早一周 |
| 8 | 笔记阅读进度 flush（visibilitychange/pagehide）与 TOC 高亮 | 静态确认监听清理 | 需停留/切后台/关闭页面并等待上报，时间成本高 |
| 9 | iOS Safari 安全区与触控 | 仅 Chromium | 缺 Safari/真机；`env(safe-area-inset-*)` 未实测 |
| 10 | `/settings` 未保存修改离开时是否提示 | 未测 | 代码未见 `beforeunload`，但需真实路由切换确认 |

---

## 5. 重复组件与技术债务

| # | 重复/债务 | 证据 | 影响 | 建议合并方向 |
|---|---|---|---|---|
| 1 | `SectionEditor` 与 `SegmentEditCard` 重复实现标题/正文/标签编辑、dirty、保存、`window.confirm` | `SectionEditor.tsx:82-113,127`；`SegmentEditCard.tsx:52-95` | 同一编辑能力两套行为，成功路径 busy 复位不一致（`SegmentEditCard` 依赖父级卸载） | 抽 `useSegmentDraft` + `SegmentForm`，两个容器只保留布局差异 |
| 2 | `QuickSwitcher` 与 `GraphSearch` 重复实现搜索浮层、键盘上下选择、结果列表 | `QuickSwitcher.tsx`、`GraphSearch.tsx` | FE-003 的根因正是两套搜索生命周期不同；样式/键盘行为漂移 | 抽 `SearchOverlay`（数据源适配器 + 统一键盘/焦点管理），两处复用 |
| 3 | `/ask` 存在两套同宽渲染路径（`max-w-[42rem]` 于 371、625） | `ask/page.tsx:371,625` | 上下文 chip、输入区、错误态容易改一处漏一处 | 合并为单一 `AskView`，按状态切换内容 |
| 4 | 错误信息直接把 `err.message` 传给 `ErrorState`/`InlineFeedback` | `ErrorState.tsx:32` 及各调用点 | 出现 `Failed to fetch` 等原文（FE-011） | 在 `lib/client.ts` 统一 `friendlyError()` |
| 5 | 7 处原生 `window.confirm` 确认框 | `SegmentEditCard.tsx:85,95`、`SectionEditor.tsx:127`、`segments/[id]:126`、`notes/[id]:724,776,875` | 样式不可控、移动端体验差、无法键盘定制 | 统一 `ConfirmDialog`（焦点陷阱 + 危险色） |
| 6 | 容器宽度 4 档混用 | 见 FE-016 | 视觉跳变、响应式规则分散 | 定义 layout token |
| 7 | 图谱设置面板标签无 `nowrap/shrink-0` | `KnowledgeUniverse.tsx:1091-1101` | 移动端逐字换行（FE-006） | 标签栏横向滚动或网格化 |
| 8 | 图谱细节面板标题未使用已知节点名 | `GraphDetailPanel.tsx:81-88` | FE-009 | 标题与正文状态解耦 |
| 9 | 夹具与文档规模不一致 | `public/fixtures/graph-large.json`=8,000；历史文档标注 20,000 | 性能目标无法回归，报告口径失真 | 重新生成 20k/50k 夹具并更新脚本/文档 |
| 10 | 设置页配置生命周期无 `loaded/dirty` 抽象 | `settings/page.tsx:89-126` | FE-001/004/005 的共同根因 | 抽 `useRemoteConfigForm`（加载闸门、脏标记、单飞、分区反馈） |

---

## 6. 桌面端与移动端问题对照

| 项 | 桌面 1440×900 | 移动 390/375/320 | 差异结论 |
|---|---|---|---|
| 页面横向溢出 | 无 | 无（`scrollWidth == innerWidth`） | 良好；仅代码块内部横向滚动 |
| 图谱 Ctrl+K | 无效 | 无效 | 两端口一致失效（FE-003） |
| 图谱设置面板 | 6 个标签单行可读 | 38×48，逐字两行 | 移动端专属（FE-006） |
| 图谱详情 | 右侧 380px 面板 | 底部 sheet 390×426，关闭可点 | 布局合理；标题/错误态问题两端共有（FE-009） |
| 图谱性能 | 5k/8k 布局期 6.2/3.6fps | 5k 同样 16.2s，23 条 longtask | 两端共有，移动端更依赖帧率（FE-002） |
| 笔记目录 | 右侧 sticky 栏（≥1280） | 浮层，无显式关闭按钮 | 移动端专属（FE-014） |
| 代码块 | 完整显示 | 右侧裁切、无滚动提示 | 移动端专属（FE-013） |
| 标签信息 | 列表展示 | `hidden sm:inline` 隐藏 | 移动端专属（FE-015） |
| 触控目标 | 鼠标不受影响 | 多个 18-41px 高 | 移动端专属（FE-007） |
| 底部快捷键提示 | 合理 | 无 Ctrl 键仍显示 | 移动端专属（FE-017） |
| 设置/导入表单 | 单列，宽度 672/768 | 单列可滚动，底部导航不遮挡 | 布局良好；设置页按钮偏小 |

---

## 7. 建议的修复批次与依赖

### 批次 1：设置页生命周期（FE-001 + FE-004 + FE-005）— 最先做

- 前置：无。
- 改动面：`src/app/settings/page.tsx`（加载闸门、脏标记、单飞、分区反馈）；必要时 `api/settings/route.ts` 改为只更新传入字段。
- 风险：中。加载闸门可能让页面在慢网下更久不可编辑，需要骨架/重试；PATCH 语义改动需兼容现有调用。
- 验收：中止 config → 不可保存且有错误；快速选自定义不回滚；保存/测试互斥。

### 批次 2：图谱快捷键（FE-003）

- 前置：无。
- 改动面：`GraphTopBar.tsx` / `KnowledgeUniverse.tsx` / `GraphSearch.tsx`。
- 风险：低。注意不要与全局 QuickSwitcher 的 Ctrl+K 冲突（两者不在同一页面）。
- 验收：真实 `Control+K` 与合成事件均能打开，Esc 关闭。

### 批次 3：移动端布局与可达性（FE-006 + FE-007 + FE-013 + FE-014 + FE-015 + FE-017）

- 前置：批次 2 不冲突；纯样式改动。
- 风险：低。需在 320/375/390 三档截图回归，避免标签/按钮换行引发新溢出。
- 验收：触控脚本重跑无 `<32px` 独立按钮；设置标签单行；320 无横向溢出。

### 批次 4：图谱性能（FE-002）

- 前置：先固化 500/5,000/8,000 基线（`scripts/measure-graph.mjs`），确认产品可接受的目标；需要 20k 夹具（见债务 #9）。
- 风险：高。`cooldownTicks`/降采样会改变布局观感；Worker 化涉及依赖，需单独立项。
- 验收：见 FE-002 验收。

### 批次 5：数据层与文案打磨（FE-009 + FE-010 + FE-011 + FE-012 + FE-016）

- 前置：FE-010 缓存必须在 PATCH/删除/导入后失效，建议与批次 1 的 PATCH 语义一起设计。
- 风险：中（缓存一致性）；其余低。
- 验收：详情 p50 <200ms；错误文案中文；双击单请求；宽度 token 统一。

---

## 8. 证据索引

证据目录：`docs/plans/frontend-quality-audit-evidence/`

- 原始数据：`audit-raw.json`（页面文本/溢出/控制台）、`api-latency.json`、`interaction-results.json`、`graph-results.json`、`graph-deep.json`、`final-checks.json`、`flows-deep.json`、`touch-targets.json`。
- 页面基线：`desktop-*.png`、`mobile-*.png`（11 页桌面 + 10 页移动）。
- 缺陷复现：`flow-settings-config-load-failure.png`、`flow-settings-custom-validation.png`、`flow-settings-race-after-load.png`、`flow-settings-concurrent.png`、`flow-graph-ctrl-k.png`、`flow-graph-ctrl-k-synthetic.png`、`flow-graph-detail-error.png`、`flow-graph-detail-panel.png`、`flow-map-panel-375x667.png`、`flow-map-panel-320x720.png`、`flow-mobile-toc.png`、`flow-error-*.png`、`flow-study-success.png`、`flow-import-error.png`。
- 性能：`perf-graph-real.png`、`perf-graph-mid.png`、`perf-graph-large.png`、`perf-graph-mid-settled.png`、`perf-graph-large-settled.png`。

> 说明：截图中左上角的 “N / Cache disabled” 是 Next.js dev overlay，不是产品缺陷，未计入清单。设置页 API Key 区域已在截图与 JSON 中脱敏。
