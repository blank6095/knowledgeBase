# 阶段 1 实现侧验收（Lead）

> 采集：2026-10-30 20:05–20:12（Asia/Shanghai），Next dev `http://localhost:3000`，系统 Chrome，桌面 1440×1000 @2x、移动 375×812。
> 脚本：`artifacts/verify-phase1.mjs`；机器可读结果：`artifacts/phase1-lead-verify.json`。
> 关联任务：U1-2 / U1-3 / U1-4 / U1-5 / U1-6 / U1-7（U1-1 仍待 UQ1/UQ3 拍板，未实施）。

## 结论

| 项 | 实测 |
|---|---|
| 沉浸布局（U1-2） | canvas top=0、height=1000=视口高；无页面横向滚动；侧边栏/footer 隐藏；悬浮导航存在 |
| 顶栏（U1-4） | 品牌「知识宇宙」、搜索位占位文案「搜索知识、概念、标签…」+ Ctrl K、统计「15 知识点 · 16 关系」 |
| 悬浮导航（U1-3） | 唯一 nav；7 项（知识宇宙/知识库/今日学习/学习复盘/AI 助手/外观主题-disabled/退出登录），active 知识宇宙 |
| 图例（U1-7） | 默认收起；展开出现「记忆度」浮层；可再次收起 |
| 详情面板（U1-5） | 单击节点后面板出现并进入 ok 态：标题/文档/记忆度 1%·关联 2/路径/无摘要提示/2 条直接关联/五操作；展开一阶关联 `aria-pressed=true` |
| 编辑深链 | 面板「编辑知识点」→ `/segments/<id>#edit`，页面进入编辑态（按钮变「✓ 完成编辑」） |
| 双击（U1-6） | 同节点 80ms 内两次点击 → `/segments/<id>`（无 hash） |
| 空白单击 | 打开面板后点画布空白 → 面板消失（count=0） |
| 双选回归 | 联系两概念 → 单击节点「已选 1/2」，URL 仍 `/graph` |
| fixture 模式 | `?fixture=graph-small`：500 节点，统计显示 500 知识点 |
| 移动端 375×812 | scrollWidth=375=innerWidth（无横向溢出）；底部导航存在（bottom=800/812）；详情面板在导航之上（bottom-16） |
| 控制台 | 0 console error、0 page error |

## 截图

- `artifacts/phase1-desktop-default.png` — 桌面沉浸默认态（导航/顶栏/图例）
- `artifacts/phase1-desktop-detail.png` — 桌面详情面板
- `artifacts/phase1-desktop-legend.png` — 图例展开
- `artifacts/phase1-desktop-fixture.png` — fixture 500 节点
- `artifacts/phase1-edit-deeplink.png` — 编辑深链进入编辑态
- `artifacts/phase1-mobile-default.png` / `phase1-mobile-detail.png` — 移动端

## 实现落点

- 新增：`src/lib/graph/click-intent.ts`、`src/lib/__tests__/click-intent.test.ts`、`src/components/graph/{GraphDetailPanel,GraphNavigation,GraphTopBar,GraphLegend}.tsx`
- 改：`src/components/graph/KnowledgeUniverse.tsx`（编排/点击语义/详情数据/一阶高亮）、`GraphCanvas.tsx`（全幅尺寸、focus 调光、背景单击、移除重复提示）、`GraphBackground` 无改动、`src/components/AppShell.tsx`（/graph 沉浸模式）、`src/app/segments/[id]/page.tsx`（`#edit` 深链，`useSyncExternalStore` 读 URL，不在 effect 里 setState）
- 单测：click-intent 6 条通过（`npx vitest run src/lib/__tests__/click-intent.test.ts`）

## 待 QA 门禁（task-10）

typecheck/lint/test/build/e2e、真实页面功能复核、三档性能（对照 `graph-baseline.phase0.json`，同环境口径）、阶段 1 截图。
**门禁口径说明**：U1-1（登录首屏策略）依赖 UQ1/UQ3 拍板，本批未实施；阶段 1 门禁除「登录首屏即图谱」一项外应全部通过，结论按「部分通过，U1-1 待决策」记录，不应判为失败。
