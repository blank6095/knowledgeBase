# 阶段 3（主题系统）+ UQ2 + U4-4 实现侧验收（Lead）

> 采集：2026-10-30 22:20–22:32（Asia/Shanghai），dev `http://localhost:3000`，Chrome 1440×1000 @2x / 375×812。
> 脚本：`artifacts/verify-phase3.mjs`、`artifacts/verify-phase3b.mjs`；机器可读：`phase3-lead-verify.json`、`phase3-ask-verify.json`。
> 关联：U3-1/U3-2/U3-3/U3-4/U3-5、U1-1/UQ2、U4-4。

## 结论

| 项 | 实测 |
|---|---|
| 默认冷色 | `html[data-graph-env=deep-space]`；`--color-accent=#5cc8e6`、`--color-app=#0a1020`（暖琥珀不再作 UI 主色；记忆度图例仍为琥珀梯度） |
| 4 套环境切换 | 深空→数字空间→极光→极简：html 与背景层 data 属性同步、accent 分别 #66d9ff/#7be0c0/#cfe0ef；每次切换 **0 业务请求**、engineStop 不变（5260.5ms 三次一致） |
| 4 种节点风格 | 光点/晶体/线框/能量球切换即时；截图 `phase3-style-*.png`；记忆度颜色与节点半径语义不变 |
| 主题面板 | 外观主题入口打开「主题」tab：4 环境卡（选中态 + aria-pressed）、4 风格分段、光晕/背景强度滑块、恢复默认；截图 `phase3-theme-panel.png` |
| 持久化 | 修改后 localStorage `kb.graph.preferences.v1` = `{"version":1,"environment":"minimal","nodeStyle":"orb","glow":1.4,"background":1}`；刷新后 html/背景/滑块恢复；损坏 JSON/版本不符/非法 id/存储抛错由单测覆盖（9 条） |
| 全站窄导航 | `/notes` 唯一 nav、无旧 aside、无横向溢出；移动 375 底部 nav 12..363；页脚 top=957/1000 |
| U1-1 | 登录后落 `/graph` |
| U4-4 | `/ask?segment=<id>` chips=「TCP 与 UDP」；发送请求体 `context.segmentIds=[id]`；非法 id 无上下文无错误；`?path=id1,id2` chips=2 且预填「解释这些知识点之间的关系」；详情「AI 解释」→ `/ask?segment=<id>` |
| 控制台 | 0 console error、0 page error（修复主题 store 的 getServerSnapshot 缓存 + 输入框水合期 caret 样式差异后） |

## 实现落点

- `src/lib/graph/graph-theme.ts`：4 冷色环境 + 4 节点风格 + 默认偏好 + `applyGraphEnvironment`。
- `src/lib/graph/graph-preferences.ts`：localStorage 版本化解析、clamp、损坏/禁用静默降级；外部 store（`useSyncExternalStore`）供 UI 订阅，避免 effect 内 setState。
- `globals.css`：4 套 `html[data-graph-env]` 冷色 token（app/surface/elevated/line/primary/muted/accent/canvas…）、环境光、`.graph-background` 四套静态纹理（深空星点/数字网格/极光/极简）。
- `node-sprites.ts`：sprite 支持 orb/crystal/wire/energy，缓存键含风格；记忆度颜色由 NodePaint 决定。
- `GraphCanvas/GraphBackground`：`nodeStyle`、`glowMult`、`graphEnvIntensity` 接入。
- `KnowledgeUniverse`：偏好 store、主题 tab、外观入口、水合门控（SSR 首帧渲染默认外观）。
- `AppShell` + `GraphNavigation.onSelect`：全站窄导航；`security.ts` 默认 `/graph`。
- `GraphDetailPanel`「AI 解释」与 compare bar「问 AI」接线 `/ask?segment|path`。

## 截图

`phase3-default-cold.png`、`phase3-theme-panel.png`、`phase3-env-digital/aurora/minimal.png`、`phase3-style-crystal/wire/energy/orb.png`、`phase3-notes-rail.png`、`phase3-mobile-notes.png`、`phase3-graph-cold.png`、`phase3-ask-segment.png`、`phase3-ask-path.png`。

## 待 QA（task-25）

完整门禁 + 阶段 3 三连测（不请求/不重排/语义不变）+ 8k 四风格帧率 + 持久化异常场景 + U4-4 服务端注入 + 全站导航回归。
