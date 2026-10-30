# 阶段 4（部分：U4-1/U4-2/U4-5）实现侧验收（Lead）

> 采集：2026-10-30 21:02（Asia/Shanghai），Next dev `http://localhost:3000`，系统 Chrome，桌面 1440×1000 @2x / 移动 375×812。
> 脚本：`artifacts/verify-phase4.mjs`；机器可读：`artifacts/phase4-lead-verify.json`。
> 范围说明：阶段 3 仍阻塞于 UQ8；本批仅做不依赖主题决策的 U4-1/U4-2/U4-5，U4-3/U4-4 待 UQ6/UQ7。

## 结论

| 项 | 实测 |
|---|---|
| U4-1 一阶/二阶循环 | 详情面板按钮循环：`展开一阶关联` → `展开二阶关联` → `收起关联` → `展开一阶关联`；两次展开 `aria-pressed=true`；截图 `phase4-focus-1hop.png` / `phase4-focus-2hop.png` |
| U4-2 直接路径 | 双选「TCP 与 UDP ↔ OSI 七层模型」→ `路径：TCP 与 UDP → OSI 七层模型（同文档）`，出现「清除路径」开关 |
| U4-2 间接路径 | 双选「概述 ↔ 核心区别：多线程 vs 单线程」→ `路径：概述 → 默认行为确实一样：都是单例 → 核心区别：多线程 vs 单线程（同文档 / 同文档）`；两段连线高亮、其余节点/边调暗（`phase4-pathIndirect.png`） |
| U4-2 无路径 | 双选「TCP 与 UDP ↔ 概述」→ `两个知识点之间没有路径`，无路径开关 |
| U4-5 桌面右键 | 节点右键弹 `role=menu`，7 项：聚焦/展开一阶/展开二阶/阅读/编辑 + 2 个 disabled（标记为重要、加入今日学习，带未实现说明）；Esc 关闭成功 |
| U4-5 菜单动作 | 点「展开二阶关联」→ 详情面板打开且按钮显示「收起关联」（depth=2 生效） |
| U4-5 移动端长按 | 375×812 下合成 `pointerdown(touch)` 500ms → 菜单可见（`phase4-mobile-menu.png`） |
| 控制台 | 0 console error、0 page error |
| 单测 | `graph-focus.test.ts` 14 条通过（一/二阶、上限截断、去重、最短路径直达/间接/无路径/自环/平行边）；全量 `npm test` **270 用例** |
| 静态检查 | typecheck 0、lint 0 warning |

## 实现落点

- 新增 `src/lib/graph/graph-focus.ts`：`collectNeighborIds`（BFS 含 seed、浅层优先、maxNodes 稳定截断）、`shortestPath`（无向 BFS、返回每段原始方向/类型）、`pathEdgeKey`。
- `KnowledgeUniverse.tsx`：`focusDepth 0|1|2` 状态 + 二阶上限 300；compare 双选自动计算最短路径、compare bar 显示节点链与关系类型、路径开关；contextMenu 状态/动作；搜索选中时清空菜单。
- `GraphDetailPanel.tsx`：`focusActive` → `focusDepth`，按钮文案随阶数循环。
- `GraphCanvas.tsx`：路径节点/边调光与 2.2× 加粗（`pathNodeIds`/`pathEdgeKeys`）；右键 `onNodeRightClick`；移动端长按（500ms、位移 <10px、最近节点 28px 命中、`onClickCapture` 抑制合成 click）。
- 新增 `src/components/graph/GraphContextMenu.tsx`（phase4-ui）：`clampPopover` 夹取、role=menu、键盘操作、disabled 项。

## 待 QA 门禁（task-19）

typecheck/lint/test/build/e2e；U4-1 邻居集合复算与调光；U4-2 三种路径的真实高亮/连线亮度、edges 未被修改；U4-5 菜单不越界/键盘可达/长按；8k 与阶段 0–2 回归；性能三档同环境中位数 ±10%。
