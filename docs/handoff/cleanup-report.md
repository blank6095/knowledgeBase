# 清理报告（2026-11-02）

> 范围：仓库根目录的临时产物、截图、文档归档。**未执行任何 git 写操作**（无 add/commit/stash/checkout/reset），未修改 `src/`、`scripts/`、`e2e/`、`public/`、数据库 schema/migrations、配置与用户未提交的业务改动。
> 基线：`master @ c4c9591`，工作区原有 30+ 个已修改文件与多个未跟踪文件保持不变。

## 1. 已删除（可再生 / 无引用）

| 路径 | 大小 | 理由 | 可恢复性 |
|---|---|---|---|
| `test-results/.last-run.json` | 45 B | Playwright 运行状态文件；`.gitignore` 忽略，运行测试会自动重建 | 重新跑 `npm run test:e2e` 生成 |
| `test-results/`（目录） | 0 MB | 删除上一条后为空目录 | 自动重建 |
| `artifacts/final-pwa-build.log` | 2.1 KB | 未跟踪的 PWA 验收日志，无文档引用 | 不可经 git 恢复；重跑构建可重建 |
| `artifacts/final-pwa-e2e.log` | 11.6 KB | 同上 | 同上 |
| `artifacts/final-pwa-lint.log` | 0 KB | 同上 | 同上 |
| `artifacts/final-pwa-test.log` | 6.9 KB | 同上 | 同上 |
| `artifacts/final-pwa-typecheck.log` | 0.1 KB | 同上 | 同上 |
| `artifacts/final-pwa2-build.log` | 2.1 KB | 同上 | 同上 |
| `artifacts/final-pwa2-e2e.log` | 6.2 KB | 同上 | 同上 |
| `artifacts/final-pwa2-lint.log` | 0 KB | 同上 | 同上 |
| `artifacts/final-pwa2-test.log` | 6.9 KB | 同上 | 同上 |
| `artifacts/final-pwa2-typecheck.log` | 0.1 KB | 同上 | 同上 |

合计：约 36 KB + 1 个空目录。`playwright-report/`、`coverage/` 本就不存在。

## 2. 文档归档（移动，未删除）

> **现状提示（2026-11-04）**：下表记录的是 2026-11-02 当时的归档动作，保持历史原貌。其中 3 个「无归档横幅的重复副本」已在后续清理中删除，详见本报告 §8；判断当前文件是否存在请以 §8 与 [../README.md](../README.md) §6.2 为准。

以下文件为 `docs/` 根目录的历史版本/重复稿，已移动到 `docs/archive/`，内容逐字节保留。git 会显示为“原路径 D + 新路径未跟踪”，可用 `git show HEAD:<原路径>` 取回原文件。

| 原路径 | 新路径 | 大小 | 理由 |
|---|---|---|---|
| `docs/graph-performance-plan.md` | `docs/archive/graph-performance-plan-根目录旧版-2026-11-02.md` | 10.2 KB | 与 `plans/graph-performance-plan.md` 重复，根目录版本更旧 |
| `docs/knowledge-universe-tasks.md` | `docs/archive/knowledge-universe-tasks-根目录旧版-2026-11-02.md` | 46.7 KB | 与 `plans/knowledge-universe-tasks.md` 重复且更旧 |
| `docs/llm-optimization-plan.md` | `docs/archive/llm-optimization-plan-根目录旧版-2026-11-02.md` | 8.7 KB | 与 `plans/llm-optimization-plan.md` 重复且更旧 |
| `docs/systematic-iteration-plan.md` | `docs/archive/systematic-iteration-plan-根目录旧版-2026-11-02.md` | 9.6 KB | 与 `plans/systematic-iteration-plan.md` 重复且更旧 |
| `docs/ux-optimization-plan.md` | `docs/archive/ux-optimization-plan-根目录旧版-2026-11-02.md` | 16.0 KB | 与 `plans/ux-optimization-plan.md` 重复且更旧 |
| `docs/visual-iteration-plan.md` | `docs/archive/visual-iteration-plan-根目录旧版-2026-11-02.md` | 34.9 KB | 与 `plans/visual-iteration-plan.md` 重复且更旧 |
| `docs/GPT建议.md` | `docs/archive/GPT建议-根目录旧版-2026-11-02.md` | 39.6 KB | 历史建议稿，已被 `plans/` 与现行台账取代 |
| `docs/project-context.md` | `docs/archive/project-context-根目录旧版-2026-11-02.md` | 41.4 KB | 旧版项目上下文，已被 `项目全景说明.md` 与本交接包取代 |
| `docs/knowledge-universe-roadmap.md` | `docs/archive/knowledge-universe-roadmap-2026-11-02.md` | 13.2 KB | 路线图已被 `plans/knowledge-universe-tasks.md` 取代 |
| `docs/graph-star-cluster-layout.md` | `docs/archive/graph-star-cluster-layout-2026-11-02.md` | 18.0 KB | Star/Cluster 布局实验记录，已并入图谱计划 |
| `docs/obsidian-gap-analysis.md` | `docs/archive/obsidian-gap-analysis-2026-11-02.md` | 15.6 KB | 历史差距分析，结论已吸收进 `spec.md` / 台账 |
| `docs/排查.md` | `docs/archive/排查-并入常见问题排查-2026-11-02.md` | 22.7 KB | 已被 `常见问题排查.md` + 既有 `archive/排查-原始审计-2026-10-29.md` 取代 |

未移动：`docs/前端缺陷清单与修复方案.md`（未跟踪的用户新文档，30.2 KB），按“不动用户未提交内容”原则保留在原位，已在 `docs/README.md` 标为“待确认”。

注意：`docs/未完成任务清单.md` 等现行文档中存在指向上述根目录旧路径的链接（部分原本就是失效的 `file:///D:/Project/...` 绝对链接）。因这些文档含用户未提交修改，本次**未改写其链接**；后续维护时可按本表的新路径批量替换。

## 3. `.screenshots/` 清单（仅列清单，未删除）

均为 **git 跟踪**（删除后可用 git 恢复），全仓库 **无任何文档/代码引用**（`grep` 无命中）。判断为旧版搜索/首页验收截图，已被 `docs/images/` 的现行截图取代。

| 路径 | 大小 | 引用情况 | 过期判断 |
|---|---|---|---|
| `.screenshots/home-check.png` | 1.58 MB | 无 | 首页旧版验收图，已被 `docs/images/10-dashboard.png` 取代 |
| `.screenshots/login-check.png` | 0.70 MB | 无 | 登录页旧版验收图，已被 `docs/images/01-login.png` 取代 |
| `.screenshots/search-overlap-desktop.png` | 3.69 MB | 无 | 搜索词重叠缺陷的旧证据，图谱搜索已重做 |
| `.screenshots/search-overlap-mobile.png` | 0.92 MB | 无 | 同上（移动端） |
| `.screenshots/search-position-desktop.png` | 3.71 MB | 无 | 搜索结果定位缺陷的旧证据，已修复 |
| `.screenshots/search-position-mobile.png` | 0.94 MB | 无 | 同上（移动端） |
| `.screenshots/search-size-desktop.png` | 3.72 MB | 无 | 搜索框尺寸缺陷的旧证据，已修复 |
| `.screenshots/search-size-mobile.png` | 0.95 MB | 无 | 同上（移动端） |

**建议**：确认后整目录删除（约 16.2 MB）；因全部被 git 跟踪，恢复只需 `git restore .screenshots`（本次未执行）。

## 4. `docs/images/` 重复截图（保留，未删除）

`docs/images/` 现有 **31 张 PNG**，为两批采集：

- **15:34 旧批（15 张）**：`01-login`、`02-dashboard`、`03-notes`、`04-note-detail`、`05-segment-detail`、`06-graph`、`07-graph-fixture-small`、`08-graph-fixture-mid`、`09-progress`、`10-study`、`10b-study-reveal`、`11-ask`、`12-import`、`13-settings`、`14-graph-fixture-large`。
- **15:55 新批（16 张，现行）**：`02-graph`、`03-graph-search`、`04-graph-detail`、`05-graph-compare`、`06-graph-theme`、`09-graph-fixture-large`、`10-dashboard`、`11-notes`、`12-note-detail`、`13-segment-detail`、`14-progress`、`15-study`、`16-study-reveal`、`17-ask`、`18-import`、`19-settings`。

保留原因：旧批仍被 `docs/项目全景说明.md` 引用（§10 图注），直接删除会造成现行文档断图；新批已用于 `docs/handoff/screenshots/`。`docs/README.md` 中的“19 张”已更正为“31 张（两批）”。

**建议**：等 `项目全景说明.md` 重写图注后，删除 15:34 旧批中的重复页面图（`02-dashboard`、`03-notes`、`04-note-detail`、`05-segment-detail`、`06-graph`、`09-progress`、`10-study`、`10b-study-reveal`、`11-ask`、`12-import`、`13-settings`，约 15.6 MB），保留 `01-login`（唯一登录图）与 07/08/14 fixture 图（新批只有 large）。

## 5. 保留未删（报告项）

| 路径 | 大小 | 原因 |
|---|---|---|
| `.next/` | 414.5 MB | 构建缓存；按用户指示不删，仅报告。可随时删除并由 `npm run build` 重建 |
| `artifacts/pwa-fix-*.png`、`pwa-fix-verify.json` | 约 7 MB | 未跟踪的 PWA 验收证据，可能是用户待提交资料，未删 |
| `artifacts/ux-defect/`、`artifacts/ux-fix-verify/`、`ux-defect-audit.mjs`、`verify-pwa.mjs` | 约 7 MB | 未跟踪的 UX 验收脚本与证据；`未完成任务清单`/缺陷文档可能引用，未删 |
| `artifacts/*.log` 以外的已跟踪 artifacts | 约 30+ MB | git 跟踪的验收产物，按规则禁止删除 |
| `.env.local` | — | 含敏感配置，未读取值、未改动、未写入任何文档 |

## 6. 交接包新增文件

| 路径 | 大小 | 说明 |
|---|---|---|
| `docs/handoff/project-dossier.md` | 38.8 KB | 完整项目说明（中文，含代码来源标注） |
| `docs/handoff/index.html` | 1.87 MB | 单文件版，17 张截图 base64 内嵌，可离线打开 |
| `docs/handoff/README.md` | — | 交接包使用说明 |
| `docs/handoff/cleanup-report.md` | 本文件 | 清理记录 |
| `docs/handoff/screenshots/*.jpg` | 1.4 MB / 17 张 | 语义化截图（1600px 宽 JPEG，原图仍在 `docs/images/`） |
| `docs/handoff/build-index.mjs` | 9.1 KB | HTML 生成脚本；保留以便 dossier 更新后重新生成，可删除 |

## 7. 未改动确认

- 未创建 git 提交；`git log -1` 仍为 `c4c9591`。
- `src/`、`scripts/`、`e2e/`、`public/`、`src/db/migrations/` 无新增修改。
- 用户原有未提交改动（30+ 文件）与未跟踪文件保持原状。
- 未读取/写入 `.env.local` 的任何值；交接包内无连接串、token、口令、API Key。

## 8. 后续处置（2026-11-04）

本报告 §1–§7 记录的是 2026-11-02 当时的状态，保持原貌不动。后续完成的两项收尾如下，现状以 [../项目全景说明.md](../项目全景说明.md) 与 [../README.md](../README.md) 为准：

| 本报告条目 | 后续动作 | 结果 |
|---|---|---|
| §2 表中 `archive/GPT建议-根目录旧版-*`、`archive/project-context-根目录旧版-*`、`archive/排查-并入常见问题排查-*` 三行 | 三份「无归档横幅、无引用」的重复副本已删除 | 正式快照 `archive/GPT建议.md`、`archive/project-context.md`、`archive/排查-原始审计-2026-10-29.md` 保留，且仍被 `plans/` 与 dossier 引用；原路径文件可由 `git show HEAD:<原路径>` 取回 |
| §4 建议「等 `项目全景说明.md` 重写图注后删除 15:34 旧批重复图」 | 图注已重写，删除旧批 11 张重复图 | `docs/images/` 由 31 张收敛为 20 张：保留 `01-login.png`（唯一登录图）、`07-graph-fixture-small.png`、`08-graph-fixture-mid.png`、`14-graph-fixture-large.png` 与 11-02 现行批 16 张；删除的 PNG 由 git 跟踪，可 `git restore` 恢复 |
| 另：两个 `*.partial.json` 审计过程文件 | 与全量 `flows-deep.json` / `graph-deep.json` 逐键值完全一致，已删除 | 全量结果保留，证据链未受影响 |

此外，§3 列出的 `.screenshots/`、§5 列出的 `.next/` 与 artifacts 等仍按原判断**未删除**；§6 的交接包文件全部保留。全部待删文件在删除前已备份到项目外临时目录。
