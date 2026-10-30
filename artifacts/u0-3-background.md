# U0-3 背景层与 Canvas 分层

> 采集：2026-10-30 19:35（Asia/Shanghai），Next dev `http://localhost:3000`，系统 Chrome，1440×1000 @2x
> 脚本：`artifacts/verify-phase0.mjs`；机器可读：`artifacts/phase0-lead-verify.json`（checks.background / checks.hover）

## 实现

| 层 | 落点 | 说明 |
|---|---|---|
| 底色 | `GraphCanvas` 容器 `bg-canvas`（`--color-canvas #0f0d0b`） | 与拆分前一致 |
| 纹理 | `src/components/graph/GraphBackground.tsx` + `globals.css` `.graph-background` | 静态 CSS：暖琥珀氛围光（radial-gradient）+ SVG 噪点（低透明度 overlay）；无视频/粒子/WebGL；`pointer-events: none` |
| 画布 | `GraphCanvas` 中 force-graph `backgroundColor="rgba(0,0,0,0)"` | 透明画布，节点/连线正常绘制；`total` 4 个 CSS 渐变层均为静态 |

`data-graph-env` 提供环境切换锚点（`deep-space` 默认 / `minimal` 纯色对照）；真实切换 UI 属阶段 3 U3-4，本批只验证架构隔离。

## 验收证据（Lead 实测）

| 验收项 | 结果 |
|---|---|
| 切换背景是否产生数据请求 | `dataRequestsDuringSwitch: []`，切换期间总请求数 0 |
| 节点坐标是否位移 | `positionsUnchanged: true`（15 节点快照逐位一致） |
| 是否触发力导向重排 | `engineStopUnchanged: true`（`__kbGraphEngineStop` 时间戳不变） |
| 背景层是否拦截指针 | `pointerEvents: "none"`；悬停节点 `document.body.style.cursor = "pointer"`，tooltip 正常（"…未读 · 阅读 1 次 · 累计 10 秒"） |
| 默认视觉 | 见 `artifacts/phase0-graph-deep-space.png`；纯色对照 `artifacts/phase0-graph-minimal.png` |
| 既有交互回归 | 筛选（未读档取消 15→6 节点）、分组/显示/力 tab、双选、普通单击跳转、fixture 500 模式全部正常 |

## 取舍记录

- force-graph 传 `rgba(0,0,0,0)` 实测可行（画布透明、节点绘制无残影），无需退回 `undefined` 方案。
- 默认环境采用暖色微光而非建议 §四·1 的冷色「深空」，因 UQ8 未拍板（暖琥珀品牌 vs 冷色环境），阶段 3 再定色板。
