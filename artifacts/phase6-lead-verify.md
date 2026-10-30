# U4-3 学习地图实现侧验收（Lead）

> 采集：2026-10-30 23:10（Asia/Shanghai），dev `http://localhost:3000`，Chrome 1440×1000 @2x / 375×812。
> 脚本：`artifacts/verify-phase6.mjs`；机器可读：`artifacts/phase6-lead-verify.json`。
> 默认口径（UQ6 未明确，按可复核默认实现）：薄弱 `memory<0.4`；到期 `reasonCode=due-review`；今日=其余今日条目；枢纽=度数 Top 10%（minDegree 2、至少 1、id 稳定）。

## 结论

| 项 | 实测 |
|---|---|
| 真实计数 vs 图例 | API 复算：weak **13** / due **0** / today **3** / hub **1**；图例显示「薄弱 13 · 到期复习 0 · 今日推荐 3 · 重要枢纽 1」完全一致 |
| 四类通道 | weak 虚线环、due 右上弧、today 左下弧、hub 外侧点线环；多类可叠加，记忆度色相/节点半径不变 |
| 记忆度颜色 | 启用前后同一节点中心 RGB 采样一致 `[232,196,132,255]` |
| 数据请求 | 启用地图仅 1 次 `/api/learning/today`；失败降级提示（今日/到期无数据，薄弱/枢纽仍可用） |
| 单独启用 | 清除后只勾「薄弱」→ 图例仅「薄弱 13」，画布只画 weak 环 |
| 移动端 375 | 地图面板可用、无横向溢出；入口/图例可见 |
| 控制台 | 0 console error、0 page error |
| 单测 | `graph-map.test.ts` 7 条通过；全量 **324 用例** |

## 实现落点

- 新增 `src/lib/graph/graph-map.ts`：`computeMapMarks`（weak/due/today/hub + 可配置阈值）、`countMapMarks`、`MAP_MARK_META`。
- `GraphCanvas`：`mapMarks` 独立绘制（不进入 sprite，故不改颜色/尺寸）。
- `KnowledgeUniverse`：设置面板新增「地图」tab、右侧「◉ 学习地图」入口、四类勾选/全部显示/清除、计数与口径说明、左下角图例 chips；启用时拉取今日学习。
- `graph-state.ts`：`TABS` 增加「地图」。

## 截图

`phase6-map-all.png`（四类全开 + 图例 + 面板）、`phase6-map-weak.png`（仅薄弱）、`phase6-map-mobile.png`（移动面板）。

## 待 QA（task-27）

独立复算四类计数、通道区分/叠加、颜色/半径不变、失败降级、移动端、阶段 0–4 回归、性能与 8k 地图 smoke。
