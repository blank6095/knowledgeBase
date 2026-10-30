# 阶段 2 实现侧验收（Lead）

> 采集：2026-10-30 20:38（Asia/Shanghai），Next dev `http://localhost:3000`，系统 Chrome，桌面 1440×1000 @2x / 移动 375×812。
> 脚本：`artifacts/verify-phase2.mjs`；机器可读：`artifacts/phase2-lead-verify.json`。
> 关联任务：U2-1 搜索索引、U2-2 搜索浮层、U2-3 四态视觉、U2-4 视口聚焦、U2-5 空态。

## 结论

| 项 | 实测 |
|---|---|
| Ctrl/Cmd+K（U2-2） | 打开浮层，`document.activeElement` = 搜索知识输入框 |
| 搜索「网络」 | 3 条结果（HTTP 状态码 / OSI 七层模型 / TCP 与 UDP），匹配原因「标签 · 网络」；输入期间 **0 次 `/api/graph`/fixture 请求**，engineStop 时间戳不变 |
| 空结果（U2-5） | 「没有找到匹配知识」可见，canvas 仍在（图谱不被清空） |
| Esc 清除 | 浮层关闭、URL 仍 `/graph`、全图恢复 |
| Enter 聚焦（U2-4） | 目标节点从 (581, 351) 平滑移动到画布中心 **(720, 500)**，dx=dy=0；期间 0 数据请求，engineStop 不变 |
| 搜索仅改视图 | 搜索前后节点快照仍为 15（未过滤/删除 nodes/links） |
| 回归 | 搜索退出后单击节点仍能打开详情面板（「阅读知识」出现） |
| 移动端 375×812 | 浮层 left=12/right=363/width=351，无横向溢出 |
| 控制台 | 0 console error、0 page error |

## 截图

- `artifacts/phase2-desktop-default.png` — 默认图谱
- `artifacts/phase2-desktop-hit.png` — 搜索「网络」命中态（浮层 + 结果列表 + 图谱淡化）
- `artifacts/phase2-desktop-empty.png` — 空结果态
- `artifacts/phase2-desktop-focus.png` — Enter 聚焦后视口
- `artifacts/phase2-mobile-search.png` — 移动端搜索

## 实现落点

- 新增 `src/lib/graph/graph-search.ts`（索引/匹配/排序，12 条单测）、`src/components/graph/GraphSearch.tsx`（浮层/键盘/空态）
- `src/lib/graph/graph-state.ts`：`computeSearchNeighborIds`、`computeLinkColor/Width` 搜索分支、`FGInstance.centerAt/zoom` 类型
- `src/components/graph/GraphCanvas.tsx`：命中/邻居/无关四态（1 / 0.75 / 0.15）、命中外发光 ×1.7 与放大 ×1.12、命中路径连线提亮与 1.8× 加粗
- `KnowledgeUniverse.tsx`：搜索状态、索引 memo（nodes 变更重建）、deferred query、`centerAt/zoom` 聚焦、顶栏入口接线
- 单测：graph-search 12 + search-visuals 5；全量 `npm test` 通过（见门禁）

## 待 QA 门禁（task-15）

typecheck/lint/test/build/e2e、真实页面命中/邻居/无关透明度与连线、8k 性能/回归、移动端截图；按 U2 口径独立复核。
