# 阶段 0 实现侧验收（Lead）

> 采集时间：2026-10-30 19:35（Asia/Shanghai）
> 环境：Next 16.4.3 dev（http://localhost:3000，`.env.local` 指向本地 Neon 库：15 知识点 / 16 边）、系统 Chrome（Playwright `channel: 'chrome'`）、viewport 1440×1000 @2x
> 脚本：`artifacts/verify-phase0.mjs`；机器可读结果：`artifacts/phase0-lead-verify.json`

## 结论

| 项 | 结果 |
|---|---|
| U0-1 行为回归 | 通过：加载 15 节点、设置面板四 tab、筛选（未读档取消后 15→6 节点且引擎重排）、双选（单击选中、停留 `/graph`）、普通单击跳转 `/segments/<id>`、hover 命中（cursor=pointer + tooltip 文案）、fixture 500 节点模式与徽标 |
| U0-2 载荷字段 | 通过：`/api/graph` 节点键含 `tags`(array) / `summary`(null 14/15) / `headingPath`(string)，原有 6 字段齐全 |
| U0-3 背景分层 | 通过：切换 `.graph-background[data-graph-env]` 深空→纯色，`dataRequestsDuringSwitch: []`（0 请求）、`engineStopUnchanged: true`、`positionsUnchanged: true`（15 节点坐标逐位一致）、背景层 `pointer-events: none` |
| 控制台 | 0 console error、0 page error |

## 证据文件

- `artifacts/phase0-graph-deep-space.png` — 默认深空背景（含微妙暖色氛围光 + 噪点纹理）
- `artifacts/phase0-graph-minimal.png` — 切换纯色背景（等价拆分前画布，用于视觉 A/B）
- `artifacts/phase0-graph-hover.png` — 节点悬停（tooltip 正常显示）
- `artifacts/phase0-graph-fixture-small.png` — `?fixture=graph-small` 500 节点压测模式
- `artifacts/u0-2-api-payload.md` — U0-2 契约与静态验证（api-payload）
- `artifacts/phase0-qa-before.md` — 改动前基线（qa-phase0）

## 代码落点

- 新增：`src/lib/graph/graph-types.ts`、`src/lib/graph/graph-state.ts`、`src/components/graph/KnowledgeUniverse.tsx`、`src/components/graph/GraphCanvas.tsx`、`src/components/graph/GraphBackground.tsx`
- 改：`src/app/graph/page.tsx`（861 行 → 薄壳）、`src/app/api/graph/route.ts`（U0-2，+tags/summary/headingPath）、`src/app/globals.css`（背景层样式）
- 验收埋点（与既有 `__kbGraphFirstTick` 同口径、只读）：`__kbGraphNodePositions`（引擎停止时坐标快照）、`__kbGraphInstance`（force-graph 实例，供 `graph2ScreenCoords` 定位）

## 待 QA 出口门禁（task-4）

`npm run build`、`npm run test:e2e`（改动后）、三档 `npm run perf:graph` 对比 `artifacts/graph-baseline.before-phase0.json`、
`/api/graph` 真实 HTTP 字段断言已在本次 Lead 验收覆盖，可作为交叉证据。
