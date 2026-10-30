# U3-4 主题面板展示组件交付（phase3-theme）

生成时间：2026-10-30
交付范围：只新增 `src/components/graph/GraphThemePanel.tsx` 与本证据文件。
未修改 `globals.css`、`KnowledgeUniverse.tsx`、`GraphCanvas.tsx`、`GraphBackground.tsx`、API、`package.json`、`docs/`；未新增依赖、未提交 git、未启动 dev server。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `src/components/graph/GraphThemePanel.tsx` | 受控展示组件：4 环境卡 + 4 节点风格分段按钮 + 光晕/背景强度 range + 可选恢复默认 |
| `artifacts/u3-theme-panel.md` | 本证据：props 签名、布局与交互、接入示例、验证结果、未决点 |

组件默认导出，文件首行 `'use client'`；props 接口具名导出：

```ts
import GraphThemePanel, { type GraphThemePanelProps } from '@/components/graph/GraphThemePanel';
```

依赖仅 `react` 的 `useId` 与 `@/lib/graph/graph-theme`（既有文件）：

```ts
import {
  GRAPH_ENVIRONMENTS,
  GRAPH_NODE_STYLES,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
} from '@/lib/graph/graph-theme';
```

---

## 2. Props 契约（与任务描述逐字一致）

```ts
export interface GraphThemePanelProps {
  environment: GraphEnvironmentId;
  nodeStyle: GraphNodeStyleId;
  glow: number;          // 0.5–1.8
  background: number;    // 0.4–1.5
  onEnvironmentChange: (id: GraphEnvironmentId) => void;
  onNodeStyleChange: (id: GraphNodeStyleId) => void;
  onGlowChange: (value: number) => void;
  onBackgroundChange: (value: number) => void;
  onReset?: () => void;
}
```

约定：

- **纯受控**：组件不持有主题状态、不读写 `localStorage`、不写 `<html data-graph-env>`、不发请求；
  持久化（U3-5）与 `applyGraphEnvironment` / 背景 / 画布参数应用（U3-1、U3-2、U3-3）全部由容器负责。
- `onGlowChange` / `onBackgroundChange` 已做 `Number(event.target.value)`，回调收到 number 而非字符串。
- `onReset` 可选：不传时不渲染「恢复默认外观」按钮。
- 四环境与四风格列表直接来自 `GRAPH_ENVIRONMENTS` / `GRAPH_NODE_STYLES`，不在此文件硬编码 id 或色值；
  将来新增环境只需改 `graph-theme.ts`。

---

## 3. 内容、布局与交互

### 3.1 主题环境（2×2 卡片）

- 每张卡：`label`（13px 主文字）+ 选中勾 `✓`、3 个 `swatches` 色点、`description`（12px 弱文字）；
- 色点颜色来自 `env.swatches`（主题数据本身），仅色点内联 `backgroundColor`，UI 外壳全部用 token；
- 选中态：`border-accent bg-accent/10` + `aria-pressed={true}`；未选中：`border-line bg-app/40 hover:border-line-strong hover:bg-surface-hover`；
- 点击调用 `onEnvironmentChange(env.id)`，卡高约 90px（≥44px 触控口径）；
- **固定 2×2 而非 `lg:grid-cols-4`**：本面板实际挂在 300px 宽设置面板内，4 列时每列约 65px 放不下
  `数字空间` + 描述；任务允许「2×2」口径。若后续改为 ≥560px 的宽 Drawer，可再加 4 列断点。

### 3.2 节点风格（四段分段按钮）

- 容器：`grid grid-cols-4 gap-1 rounded-lg border border-line bg-app/40 p-1`；
- 每段 `min-h-11`（44px），选中 `bg-accent text-accent-ink`，未选中 `text-muted hover:bg-surface-hover hover:text-primary`；
- 均带 `aria-pressed`；`title={style.description}` 提供桌面悬停说明；
- 分段下方显示当前选中风格的 `description`（如「径向光球（默认）」），移动端无 hover 也能读到说明；
- 点击调用 `onNodeStyleChange(style.id)`。

### 3.3 光晕 / 背景强度（两个 range）

| 项 | 范围 | step | 显示 |
|---|---|---|---|
| 光晕强度 | 0.5–1.8 | 0.1 | 当前值 `toFixed(1)` + `×`，如 `1.0×` |
| 背景强度 | 0.4–1.5 | 0.1 | 同上 |

- 每个滑块 = `label(htmlFor)` + `<output htmlFor>`（`font-mono tabular-nums`）+ `input[type=range]` + 一行说明；
- `input` 为 `h-11 w-full cursor-pointer accent-accent`（44px 可触控；轨道颜色用 `--color-accent`）；
- 同时设置 `aria-valuetext`（如 `1.0×`），读屏不只报数字；
- 下方说明分别为「节点外发光倍率」「画布纹理与环境光倍率」。

### 3.4 可选恢复默认 + 底部说明

- `onReset` 存在时渲染整行按钮「↺ 恢复默认外观」，`min-h-11`，token 边框 + hover；
- 面板底部固定一行说明：「切换即时生效，仅改变外观；记忆度配色与节点大小语义保持不变。」（对应 U3 出口门禁语义）。

### 3.5 无障碍 / 视觉 / 触控

- 三个区块用 `role="group"` + `aria-labelledby`（`useId` 生成 id）组织，不依赖视觉标题；
- 环境卡与风格按钮的选中态统一用 `aria-pressed`，测试可按 `aria-pressed="true"` 定位；
- 所有可点目标 ≥44px（卡片本身更高、风格段/滑块/重置按钮均 `min-h-11`）；
- 只用现有 token：`bg-elevated`（由父面板提供）、`bg-app/40`、`bg-surface-hover`、`border-line`、`border-line-strong`、
  `text-primary/muted/faint/faint-decor`、`bg-accent`、`bg-accent/10`、`text-accent`、`accent-accent`；无新增颜色值；
- 未使用 `alert/confirm/prompt`，无动画依赖（仅 150ms 颜色过渡），无横向溢出风险（`grid-cols-2` + 中文自然换行）。

---

## 4. 接入示例（Lead 在 U3-4 接线时照抄）

当前设置面板在 `KnowledgeUniverse.tsx` 的 `{panelOpen && …}` 内，tab 分支来自 `TABS`（`src/lib/graph/graph-state.ts:81`）。
建议的接线步骤（均在 Lead 的 U3-4/任务 24 写作用域内，本组件不参与）：

```tsx
// 1) graph-state.ts：TABS 增加「主题」
export const TABS = ['筛选', '分组', '显示', '力', '主题'] as const;

// 2) KnowledgeUniverse.tsx：顶部导入
import GraphThemePanel from '@/components/graph/GraphThemePanel';
import {
  DEFAULT_GRAPH_PREFERENCES,
  applyGraphEnvironment,
  type GraphEnvironmentId,
  type GraphNodeStyleId,
} from '@/lib/graph/graph-theme';

// 3) 容器状态（替换/并入现有主题状态）
const [environment, setEnvironment] = useState<GraphEnvironmentId>('deep-space');
const [nodeStyle, setNodeStyle] = useState<GraphNodeStyleId>('orb');
const [glow, setGlow] = useState(DEFAULT_GRAPH_PREFERENCES.glow);
const [background, setBackground] = useState(DEFAULT_GRAPH_PREFERENCES.background);

const resetAppearance = () => {
  setEnvironment(DEFAULT_GRAPH_PREFERENCES.environment);
  setNodeStyle(DEFAULT_GRAPH_PREFERENCES.nodeStyle);
  setGlow(DEFAULT_GRAPH_PREFERENCES.glow);
  setBackground(DEFAULT_GRAPH_PREFERENCES.background);
  applyGraphEnvironment(DEFAULT_GRAPH_PREFERENCES.environment);
  // TODO(U3-5)：同时 saveGraphPreferences(DEFAULT_GRAPH_PREFERENCES)
};

// 4) 设置面板 tab 分支（与「筛选/分组/显示/力」并列）
{tab === '主题' && (
  <GraphThemePanel
    environment={environment}
    nodeStyle={nodeStyle}
    glow={glow}
    background={background}
    onEnvironmentChange={(id) => {
      setEnvironment(id);
      applyGraphEnvironment(id); // 写 <html data-graph-env>；U3-5 再接持久化
    }}
    onNodeStyleChange={setNodeStyle}
    onGlowChange={setGlow}
    onBackgroundChange={setBackground}
    onReset={resetAppearance}
  />
)}
```

- 外观主题入口（`GraphNavigation` 的 disabled 项 / 右侧齿轮）需要由 Lead 打开设置面板并切到 `主题` tab；
  本组件不监听入口、不管理面板开合；
- 若把整个设置面板之外单独渲染主题面板（如移动端 bottom drawer），组件宽度自适应父容器，2×2 环境卡仍是安全布局；
- 建议面板容器保留 `max-w-[calc(100vw-1.5rem)]` 与 `max-h` 滚动，组件自身不设高度。

---

## 5. 验证结果

在仓库根执行（2026-10-30，本文件生成时）：

```powershell
npx.cmd eslint src/components/graph/GraphThemePanel.tsx
# 无输出，退出码 0：0 error / 0 warning

npm.cmd run typecheck
# > tsc --noEmit
# 退出码 0（本次执行时 Lead 的并行接线尚未落盘；若之后因其他文件报错，不属于本组件）
```

说明：

- 本组件没有新增测试文件（写作用域仅组件 + 证据）；交互全部为回调，无可单测的纯逻辑；
- 未起 dev server、未做浏览器截图（接线前无法从真实页面进入该 tab）；视觉/触控预留由 Lead 在 U3-4 出口门禁的 Playwright 用例验证；
- `eslint` 使用仓库默认 `eslint.config.mjs`（Next core-web-vitals + TS），无 warning 输出。

---

## 6. 未决点 / 接入注意事项

1. **持久化不在此组件**：`localStorage` key、版本校验、非法值回退属 U3-5（`graph-preferences.ts`，Lead 已有文件）；
   本组件每次交互只回调，容器需在回调里同时 `saveGraphPreferences` + `applyGraphEnvironment`，否则刷新不恢复。
2. **恢复默认只负责回调**：`onReset` 传入什么就执行什么；建议容器用 `DEFAULT_GRAPH_PREFERENCES` 统一重置四项并持久化，
   不要只重置其中两项。
3. **数值 clamp 由容器/偏好层负责**：组件把 range 原生 step 的值原样回传（0.5–1.8 / 0.4–1.5）。
   若 U3-5 的 load 返回越界值，应在读入时 clamp；组件显示会按传入值原样渲染（`toFixed(1)`）。
4. **环境卡 2×2 的决定**：300px 设置面板内 4 列不可用；当前采用「2 列→2×2」。若 Lead 把主题面板改为独立宽 Drawer（≥560px），
   可在环境网格上加 `sm:grid-cols-4`，但需确认面板实际宽度而非视口宽度（建议容器查询或直接固定 2×2）。
5. **色卡色值来源**：3 个 swatches 是 `graph-theme.ts` 的环境代表色，不是 UI token；若 U3-1 后续调整环境色值，
   面板自动跟随，无需改本文件。
6. **冷色 token 切换（U3-1）**：选中态 `border-accent/bg-accent/10` 会随 `html[data-graph-env]` 的 `--color-accent`
   自动变成对应环境的强调色（琥珀 → 冰青等），组件不写死颜色。
7. **移动端 Drawer 形态**：任务验收里的「移动端为 Drawer（限高可滚动）」由容器负责；组件只保证窄屏 2×2、无横向溢出、
   触控目标 44px，不自行决定抽屉样式。
8. **选中态测试定位**：环境卡/风格按钮均暴露 `aria-pressed`，建议 Playwright 用 `getByRole('button', { name: /深空/ })`
   再断言 `aria-pressed`；恢复默认按钮文案为「恢复默认外观」。
