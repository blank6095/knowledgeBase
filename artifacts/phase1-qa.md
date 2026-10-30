# 阶段 1 出口门禁验证（QA · phase1-qa）

- 记录人：qa-phase0
- 采集时间：2026-10-30 20:10 – 20:25（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`，分支 `master`，HEAD `43c7656`（阶段 0/1 改动均未提交）
- 工具链：Node v22.20.0 / npm 10.9.3 / Playwright 1.64.1（`channel: chrome`）/ Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 写作用域：仅 `artifacts/`；QA 未修改 `src/`、`public/`、`docs/`、`package.json`
- 覆盖范围：U1-2 沉浸布局、U1-3 悬浮导航（图谱页变体）、U1-4 顶栏、U1-5 详情面板+五操作+`#edit` 深链、U1-6 单击/双击+单测、U1-7 图例
- **U1-1（登录首屏策略）未实施**：UQ1/UQ3 未拍板，`/` 仍为默认页（实测登录后 pathname=`/`），本报告按「除首屏策略外全部通过，U1-1 待产品决策」记录，不判整体失败

## 0. 结论表

| 门禁 / 检查点 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **PASS**（exit 0，无诊断） | `phase1-qa-static.log` |
| `npm run lint` | **PASS**（exit 0，0 error / 0 warning） | `phase1-qa-static.log` |
| `npm test` | **PASS**（exit 0，36 文件 / **239 用例**，含 click-intent 6 条 = 233+6） | `phase1-qa-static.log` |
| `npm run build` | **PASS**（exit 0，Compiled 1.1s，TS 4.0s，35 静态页，`/graph` ○ Static） | `phase1-qa-build.log`、`phase1-qa-build-prod.log` |
| `npm run test:e2e` | **PASS**（最终 **6 / 6**，exit 0；首跑曾因环境锁+过期断言失败，处置见 §8） | `phase1-qa-e2e.log` |
| 沉浸布局（可视面积/滚动/375 溢出/sidebar+footer） | **PASS**（canvas 1440×1000 占视口 100%，无横纵滚动；375 无横向溢出） | `phase1-qa-verify.json` |
| 悬浮导航（7 项、外观主题 disabled+hint、active、唯一 nav） | **PASS** | 同上 |
| 顶栏（品牌/搜索位/统计与数据一致，含 fixture 500） | **PASS** | 同上 |
| 图例（默认收起→展开→收起，含未读/长明） | **PASS** | 同上 |
| 详情面板（≤300ms、字段一致、loading/error/empty、五操作、移动 Drawer） | **PASS**（生产 5 次采样 286–294ms；dev 295–304ms 说明见 §3） | 同上 + `phase1-qa-timing-prod.log` |
| 点击语义（单击不跳/双击进/双选/空白取消） | **PASS** | `phase1-qa-verify.json` |
| 回归（筛选/分组/双选/拖拽/力/暂停/箭头/标签/fixture/空态/骨架） | **PASS** | 同上 |
| 三档性能（同环境对照 `graph-baseline.phase0.json`，core ±10%） | **PASS（中位数口径）**，2 个单次离群已单列 | §7 |
| U1-1 登录首屏策略 | **待决策（UQ1/UQ3）**，非失败 | §9 |

## 1. 命令明细

| # | 命令 | 时间 | 退出码 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 20:10:33 → 20:10:37 | 0 |
| 2 | `npm run lint` | 20:10:37 → 20:10:46 | 0（0 warning） |
| 3 | `npm test` | 20:10:46 → 20:10:5x | 0（36 文件 / 239 用例） |
| 4 | `npm run build` | 20:10:55 → 20:11:10 | 0 |
| 5 | `npm run test:e2e`（首跑） | 20:11:12 → 20:11:15 | **1**（环境锁，见 §8） |
| 6 | `npm run test:e2e`（二跑） | 20:12:08 → 20:12:25 | **1**（过期 h1 断言，见 §8） |
| 7 | `npm run test:e2e`（终跑） | 20:13:45 → 20:14:01 | **0**（6/6） |
| 8 | 功能验收脚本（dev 3102） | 20:18:01 → 20:18:50 | 29/30（唯一 FAIL 为 dev 时序临界，生产复测通过，见 §3） |
| 9 | 生产构建 + 时序复测（3103） | 20:19:59 → 20:20:3x | 0（5 次采样 286–294ms） |
| 10 | `npm run perf:graph` run1/run2/run3 | 20:20:44 / 20:21:48 / 20:22:44 | 0 / 0 / 0 |

## 2. 沉浸布局 / 导航 / 顶栏 / 图例（全部 PASS）

| 检查点 | 实测 |
| --- | --- |
| 图谱可视面积 | canvas **1440×1000 @top=0**，占视口 **100.0%**（≥85% 达标）；fixture 500 模式同为 100% |
| 页面级滚动 | `scrollHeight` doc/body=1000/1000（=视口），`scrollWidth`=1440；**无双滚动条** |
| /graph sidebar | AppShell 侧边栏 `display:none`（不可见） |
| /graph footer | `display:none`（不可见） |
| 沉浸模式边界 | `/notes` 侧边栏 + footer 仍可见（沉浸仅作用于 `/graph`，未误伤其它页） |
| 悬浮导航 | 唯一 `nav[aria-label="知识宇宙导航"]`；**7 项**：知识宇宙 / 知识库 / 今日学习 / 学习复盘 / AI 助手 / 外观主题（主题系统（阶段 3 交付））/ 退出登录 |
| active | `aria-current="page"` 在「知识宇宙」，唯一 |
| 外观主题入口 | `aria-disabled="true"`，`aria-label="外观主题（主题系统（阶段 3 交付））"`，点击不跳转（URL 不变） |
| 顶栏 | `header[aria-label="知识宇宙顶栏"]`：品牌「知识宇宙」、搜索位（`搜索知识（Ctrl K）`，placeholder「搜索知识、概念、标签…」）、统计「**15 知识点 · 16 关系**」与 `/api/graph` nodes=15/edges=16 一致 |
| fixture 顶栏 | `?fixture=graph-small` → 压测徽标 + 统计「**500 知识点**」，坐标快照 500 条 |
| 图例 | 默认收起（`aria-label="展开记忆度图例"`）→ 展开「记忆度 / 未读 / 长明」（四档语义，渐变条来自 `memoryColor` 同源）→ 收起成功 |
| console/page error | 主页面累计 **pageerror=0 / console.error=0**（错误态用例主动制造的 503 网络错误已排除） |

截图：`phase1-qa-desktop-default.png`、`phase1-qa-desktop-legend.png`、`phase1-qa-desktop-fixture.png`。

## 3. 详情面板（PASS）

| 检查点 | 实测 |
| --- | --- |
| 单击 → 面板出现 ≤300ms | **生产构建 5 次采样：290.7 / 286.3 / 288.2 / 294.4 / 291.8ms（全部 ≤300）**；dev 模式 3 次：295.3 / 301.6 / 303.5ms（React dev 提交额外 ~10ms）。判定 **PASS**（以生产运行时为准，dev 临界已如实记录，非放宽） |
| 字段一致性 | 面板标题/文档名/记忆度 `1%`/关联 `2`/路径/摘要/标签 与 `GET /api/segments/<id>` 全一致（segment `cc9ae203…`，走真实 DB） |
| loading 态 | 拦截 1.5s 延迟 → `role=status aria-label="详情加载中"` 骨架出现，之后恢复 ok |
| error 态 | 拦截 503 → 错误提示 + 「重试」按钮；解除拦截点击重试恢复 ok |
| 空态 | 返回 `document:null / summary:null / refs 全空` → 「未归入文档」「暂无摘要」「暂无直接关联」 |
| 五个操作 | 阅读知识 → `/segments/<id>`；开始复习 → `/study/<id>`；编辑知识点 → `/segments/<id>#edit` 且出现「✓ 完成编辑」（编辑态生效）；AI 解释 → `/ask`；展开一阶关联 `aria-pressed` false→true→false、文案 展开↔收起 |
| 移动端 Drawer | 375×812：Drawer `top=549 bottom=748`，底部导航 `top=742 bottom=800`；nav 中心命中栈首元素在 nav 内（可点击）；两者重叠 6px（nav 因 DOM 顺序在上，仍可点击）——见 §10 观察项 |
| 关闭 | 面板 ✕ / 画布空白单击均可关闭（空白点距所有节点 ≥80px） |

截图：`phase1-qa-desktop-detail.png`、`phase1-qa-mobile-detail.png`、`phase1-qa-edit-deeplink.png`。

## 4. 点击语义（PASS）

| 检查点 | 实测 |
| --- | --- |
| 单击节点 | URL 保持 `/graph`，仅打开详情面板（700ms 后仍未跳页） |
| 双击同节点（80ms 间隔） | 进入 `/segments/<id>`，**URL 无 hash** |
| 双选模式单击 | 「已选 1/2」，URL 保持 `/graph`（仍是选择语义） |
| 空白单击 | 面板关闭（`aside` 消失） |

## 5. 回归清单（PASS）

设置面板四页签（筛选/分组/显示/力）、标题搜索输入、7 个记忆度/关联类型复选框、分组新增与删除、连线箭头开关、暂停/继续按钮、4 个力参数滑块（斥力 220 即时生效）、拖拽重排（位移 161.5px、engineStop 更新）、`?fixture=graph-small`（500 节点 + 统计 + 可视面积）、加载骨架（延迟 `/api/graph` 2.5s）、空态（「图谱还没有灯。」+ 去导入 + 悬浮导航保留）——全部通过。

## 6. 移动端 375×812（PASS）

- `scrollWidth=375=innerWidth`、`body.scrollWidth=375` → **无横向溢出**
- canvas 占视口 **100.0%**；侧边栏/footer 均隐藏；底部导航 `top=742 / bottom=800`（视口 812）
- 详情 Drawer 在导航之上（nav 仍可点击，见 §3 重叠 6px 观察）

截图：`phase1-qa-mobile-default.png`。

## 7. 三档性能（同环境对照 `graph-baseline.phase0.json`，PASS·中位数口径）

环境：同日同机（i7-12700H，1440×900 headless Chrome 156）、同一 `npm run perf:graph`；fixture 沿用现有 500/5000/8000 文件（**graph-large 实为 8000 节点**，基线 `nodes: 20000` 是脚本配置期望值，已复查三文件字节/mtime 未变）。phase0 基线 E（canonical）：small 953/1586/135.3fps、mid 1409/16568/4.55fps、large 1457/16468/2.56fps（firstTick/engineStop/fps）。

| 指标 | phase0 E | phase1 run1 | phase1 run2 | phase1 run3 | 中位数 | 中位数 Δ |
| --- | --- | --- | --- | --- | --- | --- |
| small firstTick | 953 | 1040.5 | 954.9 | 997.7 | 997.7 | **+4.7%** |
| small engineStop | 1586 | 1671.2 | 1590.5 | 1629.9 | 1629.9 | **+2.7%** |
| small fps | 135.3 | 129.98 | 130.69 | 131.32 | 130.69 | **-3.4%** |
| mid firstTick | 1409 | 1465 | 1440.4 | 1482 | 1465 | **+4.0%** |
| mid engineStop | 16568 | 16634 | 16633.1 | 16580.3 | 16633.1 | **+0.4%** |
| mid fps | 4.55 | 4.137 | 3.518 | 4.691 | 4.137 | **-9.1%** |
| large(实际 8000) firstTick | 1457 | 1929.1 | 1526.9 | 1439.6 | 1526.9 | **+4.8%** |
| large engineStop | 16468 | 17215.4 | 16823 | 16783 | 16823 | **+2.2%** |
| large fps | 2.56 | 2.412 | 2.456 | 2.419 | 2.419 | **-5.5%** |

辅指标（中位数）：small p95 13.8 / heap 18.4–20.1MB / longTask 170；mid p95 314.4 / heap 69.2–79.2MB / longTask 254；large p95 604.9 / heap 84.1–116.7MB / longTask 308。

**判定：core 三项（firstTick/engineStop/fps）三档中位数全部在 ±10% 内 → 性能门禁 PASS（同环境口径）。**

需单列的 2 个单次离群（未放宽，如实记录）：
1. run1 `graph-large firstTick=1929.1ms`（+32.4%）：该次紧跟生产构建 + 3103 服务器活动后启动，疑残余负载；run2/run3 为 1526.9/1439.6（+4.8%/+1.2%）。
2. run2 `graph-mid fps=3.518`（-22.7%）：该次 p95 也偏高 366ms；run1/run3 为 4.137/4.691。mid fps 三次离散 3.52–4.69，噪声显著大于 phase0 当日三次（4.40–4.60），建议后续门禁固定「同日 3 次取中位数」。
按 task-10 要求「明显偏差先定位再报告」：已用重复测量定位为环境波动（同代码三次中位数达标、两次离群相互独立且不同档位），未发现与 U1-2 布局改动相关的稳定劣化信号；如你要求更强证据，可再做一次 phase0 变体的同日 A/B（需实现侧临时替换 `page.tsx`，属改动 src，需你授权）。

## 8. e2e 两次失败与最终通过（实现修复，非放宽标准）

1. **首跑失败 = 环境**：`⨯ Another next dev server is already running ... PID 28648 / localhost:3000`（Lead 20:05 启动的 dev server 在 Windows 上残留子进程，20:12 已清理），`run-e2e.mjs` 自起 3100 被拒 → exit 1。非产品失败。
2. **二跑失败 = 脚本过期 + a11y 缺口**：`登录后可加载 mock 知识图谱` 断言 `heading '关系图谱'` 找不到 —— U1-4 把页面标题改为顶栏品牌 `span`，`/graph` 不再有 h1。Lead 裁决选 B（保留可访问主标题），实现侧在 `KnowledgeUniverse` 根节点补 `<h1 className="sr-only">关系图谱</h1>`（视觉仍由顶栏承担）。
3. **终跑 = 6/6 通过**（20:13:45–20:14:01，exit 0），含原失败用例；生产构建复核 h1 存在（`sr-only`，视觉宽 1px 不占布局）。这是**实现侧修复**导致通过，不是放宽断言或跳测。

## 9. U1-1 待决策记录

- `/` 仍为默认页：登录后 `afterLoginPath=/`（`isDefaultPage=true`），**未重定向到 `/graph`**；AppShell 在 `/` 保持常规布局（沉浸仅 `/graph`）。
- UQ1（登录首屏是否直接进图谱）/UQ3 未拍板 → U1-1 未实施，本门禁不将其计为失败项。

## 10. 观察项（非阻断，供阶段 2/3 参考）

1. 移动端详情 Drawer 与底部导航有 **6px 视觉重叠**（Drawer bottom=748，nav top=742）。nav 在 DOM 中靠后、同 z-30，仍可点击；若要零重叠可把 Drawer 的 `bottom-16`（64px）调到 `bottom-20`（80px，图例已用此值）。
2. `graph-mid` fps 的跨运行噪声变大（3.52–4.69），建议性能门禁改为「同日 3 次取中位数 + 记录极值」，避免单次误判。
3. 顶栏统计在 `<lg`（含移动端）按设计 `hidden`，375 下不可见；如需移动端也展示统计，需另行讨论（当前非门禁要求）。

## 11. 产物清单

- 本报告：`artifacts/phase1-qa.md`
- 功能验收：`phase1-qa-verify.mjs`、`phase1-qa-verify.json`、`phase1-qa-verify.log`
- 时序复测：`phase1-qa-timing-prod.mjs`、`phase1-qa-timing-prod.log`（生产 5 次采样）
- 截图：`phase1-qa-desktop-default.png`、`phase1-qa-desktop-detail.png`、`phase1-qa-desktop-legend.png`、`phase1-qa-desktop-fixture.png`、`phase1-qa-edit-deeplink.png`、`phase1-qa-mobile-default.png`、`phase1-qa-mobile-detail.png`
- 性能：`phase1-qa-perf.log` / `-run2.log` / `-run3.log`、`graph-baseline.phase1.json` / `.run2.json` / `.run3.json`（原始输出 `graph-baseline.json`）
- 构建/静态/e2e 日志：`phase1-qa-build.log`、`phase1-qa-build-prod.log`、`phase1-qa-static.log`、`phase1-qa-e2e.log`
- 诊断脚本（仅内部用）：`phase1-qa-diag-mobile.mjs`、`phase1-qa-final-shots.mjs`

## 12. 任务状态

- **task-10 已完成（complete）**；U1-1 作为待决策项单列，不影响其余门禁通过。
- 环境收尾：3000/3100/3102/3103/3200 全部 free，无残留 node 进程；三个 fixture 未改动。
