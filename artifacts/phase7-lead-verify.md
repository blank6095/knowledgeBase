# U4-6 小地图实现侧验收（Lead）

> 采集：2026-10-31 18:50（Asia/Shanghai），dev `http://localhost:3000`，Chrome 1440×1000 @2x / 375×812。
> 脚本：`artifacts/verify-phase7.mjs`；机器可读：`artifacts/phase7-lead-verify.json`。

## 结论

| 项 | 实测 |
|---|---|
| 开启/关闭 | 设置「显示」tab 勾选「小地图（全景导航）」→ 右下角 168×112 canvas 出现；取消即消失（默认关闭） |
| 点击跳转 | 点击小地图左下角后相机中心从 `(0,0)` → `(-285.5,160.7)`，zoom 不变；engineStop 不变；**0 业务请求** |
| 移动端 375 | 小地图 188–356（top 583–695），底部导航 top=742，不重叠；无横向溢出 |
| 语义 | 点阵按记忆度同色绘制；8k 仅采样 ≤1500 点，静态离屏缓存 + 350ms 视口刷新 |
| 控制台 | 0 console error、0 page error |
| 单测 | `graph-minimap.test.ts` 6 条；全量 **330 用例** |
| 全量门禁 | typecheck/lint/test/build 全绿；e2e 首跑 2 条冷编译超时、重跑 **6/6**（dev 冷启动抖动，非产品失败） |

## 实现落点

- 新增 `src/lib/graph/graph-minimap.ts`（bounds/project/unproject/viewportRect）与测试。
- 新增 `src/components/graph/GraphMinimap.tsx`（点阵 + 视口矩形 + 点击/拖动 centerAt）。
- `GraphCanvas` 增加 `minimap` 开关；`KnowledgeUniverse` 显示 tab 增加 checkbox（默认关闭）。

## 截图

`phase7-minimap-off.png`、`phase7-minimap-on.png`、`phase7-minimap-jump.png`、`phase7-minimap-mobile.png`。

## 待 QA（task-29）

独立验证开启/关闭、点击/拖动相机与 0 请求、8k smoke、移动端布局、回归与性能。
