# 交接包使用说明（docs/handoff）

> 本目录用于把「个人知识库」项目一次性交给网页版大模型或新接手者。
> 生成日期：2026-11-02 ｜ 代码基线：`master @ c4c9591`（工作区含未提交改动） ｜ 全部中文。

## 1. 先读哪个

| 顺序 | 文件 | 用途 |
|---|---|---|
| 1 | [project-dossier.md](./project-dossier.md) | **主文档**：定位、技术栈、目录地图、9 张表、11 个页面、37 个 API、核心机制、坑点、未完成事项，关键结论均标注源码路径 |
| 2 | 本文件 | 了解如何投喂、图片对应关系、重新生成方式 |
| 3 | [cleanup-report.md](./cleanup-report.md) | 两次清理记录（2026-11-02 归档 + 2026-11-04 后续处置）：删了什么、移动了哪些文档、如何恢复 |
| 4 | [index.html](./index.html) | 单文件版（图片 base64 内嵌），适合一次性上传或本地双击打开 |

如果对方只能收一个文件，优先发 `index.html`；如果能收多个文件，优先发 `project-dossier.md` + `screenshots/`。

## 2. 如何喂给网页版大模型

### 方案 A：单文件（推荐给只支持单文件上传的模型）

上传 `index.html`（约 1.87 MB，17 张图已内嵌）。开场提示可直接用：

```text
这是一份个人知识库项目的交接说明（单文件 HTML，图片已内嵌）。
请先通读全文，然后：
1) 用 200 字概括项目定位与核心机制；
2) 列出数据模型与 API 的关键约束；
3) 指出你认为最需要优先解决的 3 个问题，并说明依据。
回答时请引用文档中的章节号与源码路径。
```

### 方案 B：Markdown + 图片（推荐给能读多文件的模型）

依次上传：

1. `project-dossier.md`
2. `screenshots/` 下的 17 张 `.jpg`（或只传与问题相关的几张）

开场提示：

```text
附件是项目交接文档与真实界面截图。文档中凡标注 src/... 的结论都来自源码；
请把文档当作出题依据，不要凭常识补全未写明的行为。
```

### 方案 C：只问局部

- 问数据模型：只传 `project-dossier.md` §4。
- 问页面/交互：传 §5 + 对应截图（见 §3 映射）。
- 问 API：传 §6。
- 问性能/坑点：传 §7–§8。

## 3. 图片与正文对应关系

| 截图（本目录） | 原图（docs/images） | 对应 dossier 章节 | 一句话说明 |
|---|---|---|---|
| `screenshots/login.jpg` | `01-login.png` | §5 | 单口令登录页，无注册入口 |
| `screenshots/dashboard.jpg` | `10-dashboard.png` | §5、§7.3 | 首页今日推荐、统计、薄弱清单、最近导入 |
| `screenshots/graph-overview.jpg` | `02-graph.png` | §5、§7.4 | 全屏知识宇宙，亮度=记忆度 |
| `screenshots/graph-search.jpg` | `03-graph-search.png` | §5、§7.4 | `Ctrl/Cmd+K` 搜索浮层 |
| `screenshots/graph-detail.jpg` | `04-graph-detail.png` | §5、§7.4 | 节点详情面板与操作入口 |
| `screenshots/graph-compare.jpg` | `05-graph-compare.png` | §7.4、§7.5 | 双选节点“联系两概念” |
| `screenshots/graph-theme.jpg` | `06-graph-theme.png` | §7.4 | 环境 × 风格主题面板 |
| `screenshots/graph-large.jpg` | `09-graph-fixture-large.png` | §7.4、§8.4 | 大规模 fixture 渲染形态 |
| `screenshots/notes-list.jpg` | `11-notes.png` | §5 | 文档列表、标签、段数、平均记忆度 |
| `screenshots/note-reading.jpg` | `12-note-detail.png` | §5、§7.1 | 连续阅读、目录、段级灯点、标注 |
| `screenshots/segment-detail.jpg` | `13-segment-detail.png` | §5 | 知识点正文、记忆、关系、编辑入口 |
| `screenshots/progress.jpg` | `14-progress.png` | §5、§7.3 | 7 天结论、14 天热力、优先项 |
| `screenshots/study-recall.jpg` | `15-study.png` | §5、§7.3 | 主动回忆“先作答”状态 |
| `screenshots/study-reveal.jpg` | `16-study-reveal.png` | §5、§7.3 | 揭晓答案与三档自评 |
| `screenshots/ask.jpg` | `17-ask.png` | §5、§7.5 | AI 助手对话与上下文 chips |
| `screenshots/import.jpg` | `18-import.png` | §5、§7.1 | 导入页：文件/粘贴、粒度、语义拆分 |
| `screenshots/settings.jpg` | `19-settings.png` | §5、§7.5 | 设置页：Key 尾号、模型、画像、用量 |

截图统一处理：原图 2880×2000 PNG → 1600px 宽 JPEG（quality 85），保留界面文字可读性；原图未改动。

## 4. 重新生成

修改 `project-dossier.md` 后，在仓库根执行：

```bash
node docs/handoff/build-index.mjs
```

脚本会把 `screenshots/*.jpg` 转成 base64 并重写 `index.html`（需要 Node 18+，无第三方依赖）。

## 5. 安全与边界

- 本目录**不含** `.env.local` 的任何值，也不含数据库连接串、Cookie、token、口令、API Key；只出现环境变量名。
- 文档中的“当前状态”基于磁盘工作区，不等同于最新提交；关键结论请按标注的源码路径复核。
- 工作区有大量未提交业务改动，交接包刻意不修改它们；若对方要改代码，请先 `git status` 确认基线。
- 历史文档已归档到 `docs/archive/`，现行索引见 [../README.md](../README.md)；旧文档中的链接可能失效。
