# U2-2 / U2-5 搜索浮层交付（phase2-ui）

生成时间：2026-10-30
范围：只新增 `src/components/graph/GraphSearch.tsx` + 本证据文件；未修改容器 / 画布 / API / `package.json` / docs，未提交 git，未启动 dev server。

| 任务 | 文件 | 说明 |
|---|---|---|
| U2-2 | `src/components/graph/GraphSearch.tsx` | 顶部中央玻璃搜索浮层：输入、键位、结果列表、键盘交互、全局 Ctrl/Cmd+K |
| U2-5 | 同上（空态分支） | query 非空且无结果时用 `InlineFeedback` 显示「没有找到匹配知识」，图谱不遮 |

---

## 1. 最终 props 签名（与任务契约逐字一致）

```ts
export interface GraphSearchHitView {
  id: string;
  title: string;
  reason: string;      // 已本地化的匹配原因，如「标题」「标签」「摘要」「路径」
  detail?: string;     // 可选：命中字段的短文本（如标签名）
}

export interface GraphSearchProps {
  open: boolean;
  query: string;
  results: GraphSearchHitView[];
  total: number;       // 当前可见节点总数（空态/提示文案用）
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}
```

- 默认导出：`export default function GraphSearch(...)`。
- `'use client'` 位于文件首行。
- 组件是**受控**的：不持有 query / results / open，只持有内部高亮下标。
- 不新增依赖；只使用 `react` 与既有的 `@/components/InlineFeedback`。

## 2. 接入示例（Lead 可直接照抄）

```tsx
import { useMemo, useState } from 'react';
import GraphSearch, { type GraphSearchHitView } from '@/components/graph/GraphSearch';
import { buildSearchIndex, reasonLabel, searchGraph } from '@/lib/graph/graph-search';

// KnowledgeUniverse 内（节点加载完成后）
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState('');
const searchIndex = useMemo(() => buildSearchIndex(nodes ?? []), [nodes]);
const { hits, matchedIds } = useMemo(
  () => searchGraph(searchIndex, searchQuery),
  [searchIndex, searchQuery],
);
const searchHits: GraphSearchHitView[] = hits.map((hit) => ({
  id: hit.id,
  title: hit.title,
  reason: reasonLabel(hit.reason),
  detail: hit.detail,
}));

// 顶栏搜索位打开（GraphTopBar.onSearchClick）
<GraphTopBar
  nodeCount={nodes?.length ?? 0}
  edgeCount={links.length}
  fixture={fixture}
  onSearchClick={() => setSearchOpen(true)}
/>

// 浮层：放在 KnowledgeUniverse 根 div（已 relative）内，位于 GraphCanvas 之后
<GraphSearch
  open={searchOpen}
  query={searchQuery}
  results={searchHits}
  total={nodes?.length ?? 0}
  onOpenChange={setSearchOpen}
  onQueryChange={setSearchQuery}
  onSelect={(id) => {
    setSearchOpen(false);   // 契约只要求 onSelect；关闭浮层由容器决定（建议在此关闭）
    selectNode(id);         // 复用现有详情加载；U2-4 聚焦由容器/画布接线
  }}
  onClear={() => setSearchQuery('')}
/>
```

### 数据来源

| prop | 来源 |
|---|---|
| `query` | 容器 state，经 `GraphSearch.onQueryChange` 更新；不跳页、不请求接口 |
| `results` | `searchGraph(index, query).hits` → `reasonLabel(hit.reason)` 映射；`detail` 透传 |
| `total` | 当前已加载节点数 `nodes.length`（`/api/graph` 或 `?fixture=`），不新增接口 |
| `open` | 容器 state；顶栏按钮与组件内 Ctrl/Cmd+K 都通过 `onOpenChange` 更新 |
| `onSelect` | 建议复用 `selectNode(id)` 并关闭浮层；双击进入阅读仍由画布节点交互负责 |
| `onClear` | 清空 `query`（Esc 时组件再调 `onOpenChange(false)`） |

### 定位与层级

- 根节点：`absolute top-20 left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-1.5rem))] z-30`（契约固定值，未改动）。
- 需要 recent positioned 祖先：`KnowledgeUniverse` 根节点已是 `relative`；`GraphTopBar` 为 `z-20`、宽 560px 的浮层为 `z-30`，打开时覆盖顶栏搜索位而非被其遮挡。
- 玻璃质感：`rounded-2xl border border-line-strong bg-surface/85 shadow-2xl backdrop-blur-xl`（仅既有 `--color-*` token，无硬编码色值）。
- 移动端：`w-[min(560px,calc(100vw-1.5rem))]` 自动收窄；键位提示在 `<sm` 隐藏，结果条目两行布局单行截断。

## 3. 键盘与空态说明

### 键盘

| 按键 | 行为 | 实现位置 |
|---|---|---|
| `Ctrl+K` / `Cmd+K` | 全局切换浮层（`onOpenChange(!open)`，`preventDefault` 阻止浏览器默认） | 文档级 `keydown`，`open=false` 时仍监听（`GraphSearch.tsx:97-113`） |
| 打开时 | 自动 focus 输入框（`autoFocus` + `useEffect` 里的 `inputRef.current.focus()` 兜底） | `GraphSearch.tsx:115-118`、`170-171` |
| `↑` / `↓` | 循环切换高亮（`(index ± 1 + len) % len`），并把该项滚入可视区 | `GraphSearch.tsx:142-151`、`133-137` |
| `Enter` | 选中当前高亮结果 → `onSelect(hit.id)`；无结果时不动作 | `GraphSearch.tsx:152-156` |
| `Esc` | `onClear()` + `onOpenChange(false)`（清除关键词并关闭） | `GraphSearch.tsx:105-109` |
| 输入变化 | 高亮重置到 0 | `GraphSearch.tsx:184-187` |
| 中文输入法 | `isComposing` 期间忽略快捷键/方向键/Enter，不打断候选词 | `GraphSearch.tsx:99`、`140` |
| 点击结果 | `onSelect(hit.id)`；`onMouseDown` 阻止焦点离开输入框，键盘可继续操作 | `GraphSearch.tsx:212-214` |
| 点击浮层外 | 只关闭（`onOpenChange(false)`），不清空关键词；属契约外增强 | `GraphSearch.tsx:120-131` |

### 无障碍

- 输入框：`role="combobox"`、`aria-expanded`、`aria-controls`（有结果时指向 listbox）、`aria-activedescendant`（当前高亮项）、`aria-autocomplete="list"`、`aria-haspopup="listbox"`、`aria-label="搜索知识"`。
- 结果列表：`role="listbox"` + `aria-label="搜索结果"`；条目 `role="option"` + `aria-selected`，高亮项同时有底色与左侧琥珀条（颜色反馈不只靠颜色，文字层级也变化）。
- 结果计数：`role="status"`，键盘筛选时可被礼貌播报；空态 `InlineFeedback` 自带 `aria-live="polite"`。
- 焦点始终留在输入框（选项不参与 Tab 序列），符合 combobox + `aria-activedescendant` 模式。
- 键盘焦点框沿用全局 `:focus-visible` 琥珀圆环；触控/键盘目标高度：输入行 48px，结果条目 ≥44px。

### 空态（U2-5）

1. **query 非空且 `results.length === 0`**：浮层内显示 `InlineFeedback tone="warn"` 的「没有找到匹配知识」，下方补充「共 {total} 个知识点，试试更短的关键词。」；浮层无全屏遮罩，画布与图谱完整保留（契约「图谱不遮」）。
2. **query 为空**：显示引导文案「搜索标题 / 标签 / 摘要，Enter 聚焦，Esc 清除」；页脚显示「共 {total} 个知识点」与键位说明。
3. **有结果**：列表 `max-h-[min(50vh,22rem)]` 内部滚动；页脚显示「N 条结果 · 共 {total} 个知识点」。
4. 与既有「图谱还没有灯」空数据态互不影响：本组件只在搜索浮层内表达「无匹配」，不改画布/空数据分支。

## 4. 验证结果

在本机仓库根执行（2026-10-30）：

```powershell
npx.cmd eslint src/components/graph/GraphSearch.tsx
# 无输出，退出码 0 → 0 error / 0 warning

npm.cmd run typecheck
# > tsc --noEmit；退出码 0 → 0 error
```

- typecheck 在 Lead 并行接线（`KnowledgeUniverse.tsx` / `GraphCanvas.tsx`）期间执行，仍全绿；本任务未触碰这些文件。
- 按任务约束**未启动 dev server、未跑浏览器/E2E**；组件运行时表现与 Playwright 断言待 Lead 接线后统一验证。

## 5. 未决点 / 接入注意事项

1. **选中后是否关闭浮层**：契约把 `onSelect` 与 `open` 分开，组件在 Enter/点击时**只调用 `onSelect`**，不擅自关闭。建议容器在 `onSelect` 里 `setSearchOpen(false)`（上方示例已如此），否则浮层会停留在选中结果上。
2. **`aria-expanded` 取值**：当前为 `results.length > 0`（listbox 实际存在才为 true）；若 QA 口径要求「浮层可见即 true」，只需改为 `true`，其余 ARIA 关联不变。
3. **点击浮层外关闭属契约外增强**：若产品希望搜索浮层保持到显式 Esc/快捷键关闭，可删除 `GraphSearch.tsx:120-131` 的 effect。该实现用 `click`（而非 `pointerdown`）以兼容顶栏搜索按钮的 toggle 顺序：顶栏 `onClick` 先执行，文档级监听随后把状态收敛为关闭。
4. **Esc 为文档级监听（浮层打开时）**：当前图谱页没有其他全局 Esc 消费者；U4 若新增 AI 浮层/设置弹层，需要约定 Esc 优先级（建议顶层浮层 `stopPropagation` 或由容器统一仲裁），否则可能同时清空搜索。
5. **`total` 语义**：当前按「已加载节点总数」使用；若 U3 筛选后要显示「当前筛选可见节点数」，由容器传入过滤后的数量即可，组件无需改动。
6. **视觉复核**：玻璃底为 `bg-surface/85` + `backdrop-blur-xl`；若在亮色节点密集区域对比度不足，可整体换成 `bg-elevated/95`（同为既有 token），不涉及新颜色。
7. **聚焦联动（U2-4）**：本组件只负责选择回传；视口 `centerAt/zoom` 与 U2-3 四态视觉由画布/容器接线，不在本任务范围。
8. **移动端 375px**：浮层宽 `calc(100vw-1.5rem)`，`top-20` 位于顶栏（`top-3`，高约 44px）下方，无重叠；结果两行文案均 `truncate`，需要 Lead 在实机截图复核。
