# U1-3 / U1-4 / U1-7 图谱浮层组件交付（phase1-ui）

生成时间：2026-10-30
范围：只新增三个独立浮层组件，未修改容器 / 画布 / AppShell / package.json / docs。

| 任务 | 文件 | 说明 |
|---|---|---|
| U1-3 | `src/components/graph/GraphNavigation.tsx` | 左侧悬浮窄导航（桌面竖向，<md 底部横条） |
| U1-4 | `src/components/graph/GraphTopBar.tsx` | 顶部悬浮条（标识 / 搜索位 / 统计 / 压测徽标） |
| U1-7 | `src/components/graph/GraphLegend.tsx` | 右下角记忆度浮层图例，默认收起 |

---

## 1. 最终 props 签名（可直接粘贴）

```ts
// GraphNavigation.tsx
export interface GraphNavItem {
  key: string;
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
}

export interface GraphNavigationProps {
  items: GraphNavItem[];
  onLogout?: () => void;
}
```

```ts
// GraphTopBar.tsx
export interface GraphTopBarProps {
  nodeCount: number;
  edgeCount: number;
  fixture?: string | null;
  searchHint?: string;
  onSearchClick?: () => void;
}
```

```ts
// GraphLegend.tsx
export interface GraphLegendTier {
  label: string;
  color: string;
}

export interface GraphLegendProps {
  tiers: GraphLegendTier[];
  gradient: string[];
  defaultOpen?: boolean;
}
```

三个组件均为默认导出（`export default`），均带 `'use client'`。

### 图标 key 约定（GraphNavigation）

组件按 `GraphNavItem.key` 选内联 SVG，找不到时按 `href` 兜底，最后用「知识宇宙」图标：

| key | 图标语义 |
|---|---|
| `universe` / `graph` | 知识宇宙（轨道星核） |
| `library` / `knowledge` / `notes` | 知识库（书 + 书签） |
| `today` / `study` | 今日学习（日光） |
| `review` / `progress` | 学习复盘（趋势图） |
| `assistant` / `ask` / `ai` | AI 助手（对话 + 火花） |
| `theme` / `appearance` / `settings` | 外观主题（调色盘） |
| `href` 兜底 | `/`、`/graph`、`/notes`、`/study`、`/progress`、`/ask`、`/settings` |

`active` 规则：`item.active` 显式传入优先；未传时按当前 `usePathname()` 精确/前缀匹配 `href` 兜底。
`disabled` 项渲染为不可跳转的 `<button aria-disabled>`，hover/聚焦显示 `hint`。
`onLogout` 未传时不渲染退出按钮；传入时固定在导航末端分组。

---

## 2. 接入示例（Lead 可直接照抄）

> 当前 `KnowledgeUniverse.tsx` 已由 Lead 接线完成；下面是等价的最小示例与数据来源说明。

```tsx
// KnowledgeUniverse.tsx 渲染层（外层必须是 positioned 容器，GraphCanvas 根节点/现容器均已是 relative）
const navItems: GraphNavItem[] = [
  { key: 'universe', label: '知识宇宙', href: '/graph', active: true },
  { key: 'library', label: '知识库', href: '/notes' },
  { key: 'today', label: '今日学习', href: '/' },
  { key: 'progress', label: '学习复盘', href: '/progress' },
  { key: 'assistant', label: 'AI 助手', href: '/ask' },
  // 外观主题在 U3-4 就绪前置灰；就绪后改为 href 或扩展 per-item 回调
  { key: 'appearance', label: '外观主题', disabled: true, hint: '主题系统（阶段 3 交付）' },
];

const legendTiers = MEMORY_TIER_ORDER.map((tier) => ({
  label: MEMORY_TIER_META[tier].label,
  color: MEMORY_TIER_META[tier].dot,
}));
const legendGradient = [memoryColor(0.05), memoryColor(0.5), memoryColor(1)];

const logout = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  router.push('/login');
};

return (
  <div className="relative h-[100dvh] w-full overflow-hidden bg-canvas">
    <GraphCanvas ... />

    <GraphTopBar
      nodeCount={nodes.length}
      edgeCount={links.length}
      fixture={fixture}
      // 不传 searchHint 时使用规定占位文案「搜索知识、概念、标签…」
      onSearchClick={() => {/* U2-2 打开搜索浮层 */}}
    />
    <GraphNavigation items={navItems} onLogout={logout} />
    <GraphLegend tiers={legendTiers} gradient={legendGradient} />
  </div>
);
```

### 数据来源

| prop | 来源 |
|---|---|
| `GraphTopBar.nodeCount` | 已加载节点数 `nodes.length`（`/api/graph` 或 `?fixture=` 的 `payload.nodes`），不得新增接口 |
| `GraphTopBar.edgeCount` | 已加载边数 `links.length`（`payload.edges` → `setLinks`） |
| `GraphTopBar.fixture` | 现有 `fixture` state（URL `?fixture=` 读取，null 表示正常模式） |
| `GraphTopBar.searchHint` | 可选；缺省即 `搜索知识、概念、标签…`。**当前 Lead 接线传了「搜索知识、概念、标签（阶段 2 交付）」，与 U1-4 验收口径不一致，建议删除该 override** |
| `GraphNavigation.items` | 路由常量 + 当前页 active；外观主题暂时 `disabled: true, hint` |
| `GraphLegend.tiers` | `MEMORY_TIER_ORDER` + `MEMORY_TIER_META`（与节点灯光同源） |
| `GraphLegend.gradient` | `memoryColor(0.05 / 0.5 / 1)`（与旧 header 内联图例完全同源） |

### 定位与层级

- `GraphTopBar`：外层 `absolute top-3 left-3 right-3 md:left-20 md:right-4 z-20`；桌面计算值为 `top:12px / left:80px / right:16px`（符合 U1-4 契约），`pointer-events-none`，仅搜索按钮 `pointer-events-auto`。
- `GraphNavigation`：桌面 `fixed left-3 top-1/2 -translate-y-1/2 z-30 w-14`（宽 56px，按钮 44×44）；<md `fixed inset-x-3 bottom-3 z-30` 横向条，单入口 44×44。
- `GraphLegend`：`absolute bottom-20 right-3 z-20 md:bottom-4 md:right-4`，展开宽 220px；默认收起为「记忆度」胶囊。

---

## 3. 未决点 / 接入注意事项

1. **U1-4 占位文案**：组件默认值已按契约写成 `搜索知识、概念、标签…`；当前 Lead 在 `KnowledgeUniverse.tsx` 传了阶段 2 说明文案，若按验收截图核对需移除 `searchHint` override。
2. **搜索入口行为**：U1-4 只交付搜索位；`onSearchClick` 目前未接线，点击无反馈。U2-2 搜索浮层接入后由 Lead 传入打开逻辑（Ctrl/Cmd+K 全局键也归 U2-2）。
3. **外观主题入口**：U3-4 前按契约置灰；当前 `GraphNavItem` 无 per-item `onClick`，若主题面板是页内浮层而非 `/settings` 路由，U3-4 时需给契约补 `onClick?: () => void`（属后续任务，不在本批）。
4. **移动端浮层叠放**：底部导航条与画布原有「双选对比条（absolute bottom-4）」在 <md 可能重叠；图例已抬到 `bottom-20` 避让导航，但对比条仍是 `bottom-4`。建议 Lead 在移动端把对比条也抬到 `bottom-20`（或打开双选时隐藏图例）。
5. **图例与主题系统**：U1-7 只消费传入的 `tiers`/`gradient`，颜色不写死（仅空数组兜底为现有四档色）；U3 主题切换时由 Lead 换传入值即可。
6. **Suspense**：`GraphNavigation` 用 `usePathname()` 做 active 兜底。`/graph` 是静态路由，`cacheComponents` 下可在构建期解析，无需额外 Suspense（且 `AppShell` 已有 Suspense 包裹）；若未来把组件挪到带动态参数且未 `generateStaticParams` 的路由，需保持 Suspense 边界。
7. **触控目标**：桌面导航 44×44（容器宽 56），移动端入口 44×44；375px 下 6 入口 + 退出可完整容纳。更窄（≤320px）时 7 个 44px 目标会横向溢出，本批验收口径为 375。
8. **压测徽标**：<md 只显示「压测」，≥md 显示「压测 · fixture」；统计文字 <lg 隐藏（避免 768px 下与搜索位挤压），1440 完整显示 `N 知识点 · M 关系`。

---

## 4. 验证结果

在本机仓库根执行（2026-10-30）：

```powershell
npx.cmd eslint src/components/graph/GraphNavigation.tsx src/components/graph/GraphTopBar.tsx src/components/graph/GraphLegend.tsx
# 0 error / 0 warning（无输出，退出码 0）

npm.cmd run typecheck
# > tsc --noEmit 通过（0 error）
```

说明：typecheck 在 Lead 并行改动 `KnowledgeUniverse.tsx` / `GraphCanvas.tsx` / `GraphDetailPanel.tsx` 后执行，仍全绿；本批没有触碰这些文件。
