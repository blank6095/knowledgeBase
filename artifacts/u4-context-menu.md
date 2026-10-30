# U4-5 节点右键 / 长按菜单展示组件交付（phase4-ui）

生成时间：2026-10-30
交付范围：只新增 `src/components/graph/GraphContextMenu.tsx` 与本证据文件。
未修改容器（`KnowledgeUniverse.tsx`）、画布（`GraphCanvas.tsx`）、API、`package.json`、`docs/`；未新增依赖、未提交 git、未启动 dev server。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `src/components/graph/GraphContextMenu.tsx` | 受控展示组件：右键/长按浮层、`clampPopover` 视口夹取、菜单键盘交互、禁用项与 hint |
| `artifacts/u4-context-menu.md` | 本证据：props 签名、定位算法、键盘/触控、接入示例、未决点、验证结果 |

组件为默认导出，文件首行 `'use client'`；类型接口同时具名导出，供容器直接引用：

```ts
import GraphContextMenu, { type GraphContextMenuAction } from '@/components/graph/GraphContextMenu';
```

---

## 2. Props 契约（与任务描述逐字一致）

```ts
export interface GraphContextMenuAction {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface GraphContextMenuProps {
  x: number;            // 视口坐标（clientX）
  y: number;            // 视口坐标（clientY）
  title: string;        // 节点标题（菜单头部，超长截断）
  actions: GraphContextMenuAction[];
  onClose: () => void;
}
```

约定：

- `x` / `y` 必须是 **视口坐标**（`clientX/clientY`），不是画布坐标、也不是容器内相对坐标；
- 组件不持有 open 状态，父级用 `{open && <GraphContextMenu … />}` 条件渲染；
- 组件不自行计算锚点节点、不监听画布、不发请求；
- `action.key` 只用于 React 列表 key，需在单次菜单内唯一；
- `onSelect` 与 `onClose` 均按受控回调处理，父级可重复调用（幂等），组件在动作选择后会先调 `onSelect`、再调 `onClose`。

---

## 3. 定位：`clampPopover` 用法

```ts
import { clampPopover } from '@/lib/ui/geometry';

const MENU_WIDTH = 224;        // = w-56
const ITEM_HEIGHT = 44;        // = min-h-11（G17）
const MENU_PADDING_Y = 16;     // p-2 上下各 8px
const VIEWPORT_MARGIN = 8;

const estimatedHeight = actions.length * ITEM_HEIGHT + MENU_PADDING_Y;
const position = clampPopover({
  anchorX: x,
  anchorY: y,
  width: MENU_WIDTH,
  height: estimatedHeight,     // 契约口径：actions.length * 44 + 16
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  margin: VIEWPORT_MARGIN,
  placement: 'bottom',
});
// position: { left, top, placement, clampedX, flipped }
```

实现细节：

- 浮层为 `position: fixed`，只把 `position.left` / `position.top` 写进行内 `style`，宽度由 `w-56`（224px）+ `max-w-[calc(100vw-1rem)]` 双重保证；
- 首次渲染时视口尺寸尚未测量（SSR / 首帧），先按锚点原样渲染；`useEffect` 挂载后读取 `window.innerWidth/innerHeight` 并夹取；
- 监听 `resize` 与 `orientationchange` 重新夹取，转屏/缩放后不会越界；
- 高度按契约公式估算。实际渲染多出标题栏（约 37px），带 `hint` 的项也可能超过 44px，因此额外用
  `maxHeight: max(88, viewportHeight - top - 8)` + 容器 `overflow-y-auto` 兜底，内容再长也不会越过视口底边；
- 祖先节点不能有 `transform` / `filter` / `contain: paint`：它们会改变 `fixed` 的 containing block，使菜单相对该祖先定位。当前 `KnowledgeUniverse` 根节点与 `GraphCanvas` 根节点均为 `relative`（无 transform），在根节点下渲染即可。

`position` 判定口径（与 `src/lib/__tests__/ui-geometry.test.ts` 一致）：

1. 水平默认以锚点居中，越界则贴最近可用边；
2. 垂直默认在锚点下方（间距 8px），下方空间不足且上方更宽裕时翻到上方；
3. 上下都不足时贴到不越界的最大高度位置。

---

## 4. 交互、键盘与可访问性

### 4.1 生命周期

| 触发 | 行为 |
|---|---|
| 挂载 | 聚焦**首个可用项**；若全部禁用则聚焦菜单容器（`tabIndex=-1`），保证 Esc 仍可关闭 |
| 点击菜单项 | 执行 `action.onSelect()`，随后 `onClose()`；点击后菜单收起 |
| 点击菜单外 | `document` 的 `click`（冒泡）关闭；监听在挂载后的 effect 中注册，晚于打开菜单的那次事件，且回调内不调用 `preventDefault/stopPropagation`，不吞掉首次触发事件 |
| Esc | `preventDefault()` + `stopPropagation()` 后 `onClose()`，避免同时关闭底层图层 |
| 触发方式 | 组件不区分右键/长按：只要容器传入视口坐标并条件渲染，即由容器负责触发（桌面 `contextmenu`、移动端长按定时器） |

### 4.2 键盘

| 按键 | 行为 |
|---|---|
| `ArrowDown` / `ArrowUp` | 在**可用项**之间循环移动焦点；`preventDefault` 防止页面滚动；跳过 `disabled` 项 |
| `Home` / `End` | 跳到首个 / 最后一个可用项 |
| `Enter` | 对当前焦点项执行 `onSelect()` + `onClose()`；显式 `preventDefault` 阻止按钮原生 click，避免 `onSelect` 触发两次 |
| `Esc` | 关闭菜单 |
| `Space` | 未单独拦截，走按钮原生 click（等价于选择当前项） |
| `Tab` | 未拦截；焦点可离开菜单，菜单保持到点击外部或 Esc（契约未要求焦点陷阱，见 §8 未决点） |

### 4.3 ARIA / 语义

- 容器：`role="menu"`、`aria-orientation="vertical"`、`aria-labelledby` 指向头部标题（`useId` 生成 id）；
- 菜单项：`role="menuitem"`、`type="button"`；
- 禁用项：同时设置原生 `disabled` 与 `aria-disabled={true}`，不可点击、不参与方向键循环；方向键会在可用项间跳过它们；
- `hint` 以第二行弱化文本展示，并带 `title` 属性（截断时可见完整文案）；
- 头部标题单行 `truncate`，并附 `title` 属性展示完整节点标题。

### 4.4 触控与视觉

- 每个菜单项 `min-h-11`（≥44px），符合 G17 口径；不依赖 hover 才能发现可点性，`focus` 态与 `hover` 态同样有背景高亮；
- 颜色只用既有语义 token：`bg-elevated/95`、`border-line`、`text-primary`、`text-muted`、`text-faint`、`bg-surface-hover`；
- 浮层：`fixed z-50 w-56 … rounded-xl border border-line bg-elevated/95 shadow-2xl backdrop-blur-xl`，与任务要求的既有 token 一致；
- 层级 `z-50`，高于图谱现有浮层（顶栏/图例 `z-20`、详情/搜索/导航 `z-30`），避免被遮挡；
- 滚动条只在内容超出视口时出现（`overflow-y-auto` + `overscroll-contain`），头部 `sticky` 常驻；
- 无弹窗、无 `alert/confirm/prompt`、无新增依赖；交互只有 150ms 颜色过渡，无关键帧动画。

---

## 5. 接入示例（当前 Lead 已接线，以下为等价说明）

当前 `KnowledgeUniverse.tsx` 已在 `GraphCanvas` 根部接收 `onNodeContextMenu`，并已按本契约渲染：

```tsx
const [contextMenu, setContextMenu] = useState<{ node: CanvasNode; x: number; y: number } | null>(null);

// GraphCanvas 已有 prop：onNodeContextMenu(node, clientX, clientY)
<GraphCanvas
  …
  onNodeContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
/>

{contextMenu && (
  <GraphContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    title={contextMenu.node.title}
    actions={contextMenuActions}
    onClose={() => setContextMenu(null)}
  />
)}
```

动作数组要点：

```tsx
const contextMenuActions: GraphContextMenuAction[] = contextMenu
  ? [
      { key: 'focus', label: '聚焦该节点', onSelect: () => { /* 容器行为 */ } },
      { key: 'neighbors-1', label: '展开一阶关联', onSelect: () => { /* … */ } },
      { key: 'edit', label: '编辑知识点', onSelect: () => { /* … */ } },
      {
        key: 'important',
        label: '标记为重要',
        hint: '需数据模型支持（当前未实现）',
        disabled: true,
        onSelect: () => {},
      },
    ]
  : [];
```

- 动作内部的 `setContextMenu(null)` 与本组件选择后的 `onClose()` 重复，但 `setState(null)` 幂等，无副作用；
- 移动端长按由画布容器负责：当前 `GraphCanvas` 在 `pointerdown` 后 500ms、位移 <10px 时命中最近节点并调用 `onNodeContextMenu`，并在 `onClickCapture` 中对长按后的合成 click 执行 `stopPropagation + preventDefault`，因此菜单不会被抬指 click 立刻关闭（依赖容器保留该抑制逻辑）；
- 桌面右键的浏览器原生菜单由 `GraphCanvas` 根节点 `onContextMenu={e => e.preventDefault()}` 屏蔽；
- 菜单作为 `GraphCanvas` 的兄弟节点、在 `KnowledgeUniverse` 根节点（`relative`）下渲染；不要把组件放进带 `transform/filter` 的祖先内。

---

## 6. 验证结果

在仓库根执行（2026-10-30）：

```powershell
npx.cmd eslint src/components/graph/GraphContextMenu.tsx
# 无输出，退出码 0：0 error / 0 warning

npm.cmd run typecheck
# > tsc --noEmit
# 0 error（执行时 Lead 已并行接入 KnowledgeUniverse / GraphCanvas，同样通过）
```

说明：本组件没有新增测试文件（写入范围仅限组件与证据）；`clampPopover` 的纯函数逻辑已有
`src/lib/__tests__/ui-geometry.test.ts` 覆盖。若后续 typecheck 因 Lead 并行改动其它文件报错，
不属于本组件的修改范围；本文件单独 lint / 类型检查已全绿。

---

## 7. 未决点 / 接入注意事项

1. **高度公式与实际高度**：任务契约要求 `height = actions.length * 44 + 16`，未包含约 37px 的标题栏，带 hint 的项也可能超过 44px。实现已用 `maxHeight + overflow-y-auto` 兜底（不越界、内部可滚），但“上下翻转”的判断会略偏保守。若要求像素级精确翻转，需把契约公式改为包含标题栏高度（属契约变更，需 Lead 确认）。
2. **选择后自动关闭**：组件在 `onSelect` 之后调用 `onClose`。若后续某个动作需要“执行后菜单保持打开”（如连续标记），需调整组件或改为由动作自行控制；当前所有动作均为一次性语义。
3. **焦点归还**：契约未提供 trigger ref，组件关闭后不把焦点还给触发节点；键盘用户按 Esc 关闭后焦点会落到 `body`。如需完整焦点管理，需要扩展 props（如 `returnFocusRef`）或由容器在关闭时自行聚焦触发元素。
4. **Tab 行为**：未实现焦点陷阱，Tab 会把焦点移出菜单且菜单保持打开，直到点击外部或 Esc。WAI-ARIA 菜单模式通常要求 Tab 关闭菜单并归还焦点；任务未要求，暂列为后续增强。
5. **长按合成 click 的抑制在容器侧**：当前 `GraphCanvas.onClickCapture` 已处理；若后续重构去掉该逻辑，长按抬手后的 click 可能触发“点击菜单外关闭”。该职责不应下沉到展示组件（组件不监听触发手势）。
6. **滚动**：`fixed` 菜单不随页面滚动。当前图谱页是 `h-[100dvh] overflow-hidden` 的单屏布局，画布缩放/平移不是页面滚动，无影响；若未来在可滚动页面复用，父级应在滚动时关闭或重算坐标。
7. **窄视口**：`w-56`（224px）在 320/375px 下均可容纳；`max-w-[calc(100vw-1rem)]` 兜底极小视口（<240px）时收窄宽度，不改变 44px 行高。
8. **动作可用性属于容器/数据层**：「标记为重要」「加入今日学习」当前由 Lead 置灰并给出 hint（无数据模型/接口），展示组件只负责按 `disabled + hint` 呈现；是否补齐数据能力不在本组件范围。
9. **未来固定定位约束**：菜单依赖 `position: fixed` + 视口坐标；若把 `GraphContextMenu` 渲染进带 `transform`、`filter`、`backdrop-filter` 或 `contain: paint` 的祖先（都会改变 fixed 的 containing block），定位会偏移，需改为 portal 或移出该祖先。
