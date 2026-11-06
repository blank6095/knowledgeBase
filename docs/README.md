# 文档索引与维护规范

> 本目录是「个人知识库」的唯一文档源。所有文档均以当前磁盘代码为准，代码与文档冲突时以代码为准，并应回写文档。
> 维护基线：2026-11-02。

## 1. 文档地图

| 文档 | 定位 | 适合谁读 | 状态 |
|---|---|---|---|
| [README.md](./README.md) | 索引、命名与格式规范、维护约定 | 所有人 | 现行 |
| [快速开始.md](./快速开始.md) | 环境要求、安装、迁移、启动、验证、脚本表 | 首次接触项目 / 换机部署 | 现行 |
| [配置说明.md](./配置说明.md) | 环境变量全表、认证、LLM、R2、缓存、图谱 fixture 与偏好 | 部署与运维 | 现行 |
| [功能说明.md](./功能说明.md) | 逐页功能、交互与入口文件、接口对照 | 产品 / 前端 / 联调 | 现行 |
| [常见问题排查.md](./常见问题排查.md) | 启动、构建、登录、数据库、图谱、LLM、E2E 的排查手册 | 开发与自用运维 | 现行 |
| [项目全景说明.md](./项目全景说明.md) | 面向外部 LLM / agent 的单文件全景（定位、技术栈、页面、数据、坑点、截图） | 外部协作方 | 现行（含真实截图） |
| [spec.md](./spec.md) | 产品设计、关键决策与数据模型 | 产品 / 架构 | 现行（历史注记保留） |
| [未完成任务清单.md](./未完成任务清单.md) | 任务台账（**状态权威**）：已完成基线、开放项、决策项、变更记录；§8 为本轮迭代批次登记与 T01–T25 / Q1–Q3 状态追踪 | 规划 / 交接 | 现行（历史章节保留 + §8 状态追踪） |
| [执行版任务清单.md](./执行版任务清单.md) | **定义权威 · v1.2 冻结版**：六阶段与阶段 3 依赖图、全局约束（含 Git 未提交改动保护）、通用执行口径、T01 四张矩阵、T02 状态语义表、T05 两层状态模型、原型交付约定、28 个任务七字段定义、A1–A9；**§9.3 执行启动与 DEC-01 待评审决策登记** | Agent 执行 / 验收 | **已冻结 · T01 已启动**（DEC-01 待 T02 评审） |
| [迭代方向.md](./迭代方向.md) | 2026-11-04 产品设计方向 v1.0：Knowledge Universe 沉浸式改造的目标、范围与约束 | 产品 / 设计评审 | 现行（源文档） |
| [任务拆解建议.md](./任务拆解建议.md) | 对任务清单的工程化校准建议：8 项问题、依赖调整、v1.1 执行口径 | 规划 / 交接 | 现行（校准依据） |
| [plans/](./plans) | 各专项迭代计划（LLM、图谱性能、体验、视觉、图谱重构） | 专项执行者 | 计划源 |
| [plans/frontend-quality-audit.md](./plans/frontend-quality-audit.md) | 2026-11-03 全站前端质量审计（17 项缺陷）与全貌截图证据 | 前端 / 验收 | 现行；证据在 `plans/frontend-quality-audit-evidence/` |
| [archive/](./archive) | 已过期但可供追溯的历史文档 | 考古 / 审计 | 归档，不维护 |
| [handoff/](./handoff) | **交付给外部大模型 / 接手方的交接包**：dossier、语义化截图、单文件 HTML、清理报告 | 外部 AI / 新接手者 | 现行 |
| [images/](./images) | 真实运行截图（20 张 PNG：11-02 现行批 16 张 + 登录页与压测补图 4 张；1440×1000 @2x） | 文档配图 | 现行（2026-11-04 清理后） |
| [前端缺陷清单与修复方案.md](./前端缺陷清单与修复方案.md) | 2026-11-02 前端缺陷台账（35 项）与 T1–T10 修复方案 | 考古 / 缺陷回溯 | 历史台账（后续批次已按此实施；未跟踪） |

### 1.1 阅读路径建议

- 第一次运行： [快速开始.md](./快速开始.md) → [配置说明.md](./配置说明.md) → [常见问题排查.md](./常见问题排查.md)
- 想了解能做什么： [功能说明.md](./功能说明.md)
- 想把项目讲给外部 AI： [handoff/project-dossier.md](./handoff/project-dossier.md)（首选，含 API/数据模型/坑点）→ [项目全景说明.md](./项目全景说明.md)（补充截图与叙事）
- 想一次性上传给网页版模型： [handoff/index.html](./handoff/index.html)（图片 base64 内嵌）
- 想接手未完成工作： [未完成任务清单.md](./未完成任务清单.md) → [plans/](./plans)
- 想按编号执行本轮迭代： [执行版任务清单.md](./执行版任务清单.md)（先读 §4 通用执行口径）→ [迭代方向.md](./迭代方向.md) → [任务拆解建议.md](./任务拆解建议.md)；完成后把状态回填到 [未完成任务清单.md](./未完成任务清单.md) §8
- 想理解产品取舍： [spec.md](./spec.md)

## 2. 命名规则

| 类别 | 规则 | 示例 |
|---|---|---|
| 核心文档 | 中文名，名词短语，不带日期、不带版本号 | `快速开始.md`、`功能说明.md` |
| 专项计划 | 英文 kebab-case + `-plan` / `-tasks` | `plans/graph-performance-plan.md` |
| 归档文档 | 原名 + 归档原因/日期后缀（如需区分版本） | `archive/排查-原始审计-2026-10-29.md` |
| 截图 | `序号-页面标识.png`，序号为两位数，全小写 | `images/01-login.png`、`images/06-graph-theme.png` |
| 新增文档 | 先判断是否属于 `plans/`（有明确交付物与验收）或 `archive/`（已失效）；两者都不是才放 `docs/` 根 | — |

约束：

1. 一个文件只讲一件事；主题相近时扩写现有文档，不新建碎片文档。
2. 文件名不使用空格、不使用 `最终版`/`新版`/`v2` 之类不可维护的后缀；版本写在文件内的变更记录。
3. 已被替代的文档移动到 `archive/`，并在文件顶部加归档横幅，不直接删除（除截图等可再生资源）。

## 3. 格式规范

### 3.1 标题层级

- 每个文件有且仅有一个 `#` 一级标题，与文件名语义一致。
- 一级标题下先用「元信息表」交代版本、基线、事实来源、维护约定。
- 正文使用 `##` 编号章节（`## 1. xxx`），子节用 `### 1.1 xxx`；不跳级。
- 章节内不再出现无编号的 `##`，保证目录可预测。

### 3.2 元信息表模板

```markdown
| 项目 | 内容 |
|---|---|
| 文档版本 | vX.Y |
| 编制/更新日期 | YYYY-MM-DD |
| 代码基线 | 分支 / HEAD / 是否含未提交改动 |
| 事实来源 | 核实过的文件与命令，不写「根据经验」 |
| 维护约定 | 何时必须回写本文 |
```

### 3.3 表格与代码

- 对比、清单、字段说明一律用表格；表格首列为标识（编号/名称），便于引用。
- 代码、路径、命令、字段名用反引号；代码块必须带语言标签（`bash`、`ts`、`tsx`、`json`、`sql`）。
- 命令一律写仓库内真实可执行的形式（如 `npm run db:migrate`），不写伪命令。
- 引用代码位置用「路径 + 行号」，行号必须当轮核实；无法核实时只写路径。

### 3.4 链接

- 文档间跳转使用**相对路径**：同目录 `./xxx.md`，子目录 `plans/xxx.md`，上级 `../xxx.md`。
- 禁止使用 `file:///D:/...` 绝对链接与盘符链接（换机器即失效）。
- 链接文本写人类可读名称，不写裸 URL。
- 引用仓库代码时可使用仓库相对路径文本（如 `src/lib/memory.ts:100`），不要求可点击。
- 新增/移动文档后必须校验目标存在（见 §5）。

### 3.5 截图

- 必须是真实运行界面的截图，禁止占位图、示意图、生成图。
- 采集参数：Chrome、viewport `1440×1000`、`deviceScaleFactor: 2`（PNG 实际 `2880×2000`）。
- 引用使用相对路径 `images/xx-xxx.png`，图注写明「页面 + 观察点」。
- 界面改版后同步重拍并更新图注；旧图直接删除，不保留双份。

### 3.6 事实与假设

- 可核实事实与推测必须分开写：推测标注「**假设**」，仓库内无来源的标注「**待确认**」。
- 涉及版本号、脚本名、环境变量、表名、路由时，必须来自 `package.json`、`src/`、`.env.example` 的实际内容。

## 4. 维护约定

| 变更类型 | 必须更新的文档 |
|---|---|
| 新增/删除页面或路由 | [功能说明.md](./功能说明.md) §页面表、[项目全景说明.md](./项目全景说明.md) §5.1 |
| 新增/修改环境变量 | [配置说明.md](./配置说明.md) §环境变量、`.env.example`、[快速开始.md](./快速开始.md) |
| 新增数据库迁移 / 表字段 | [spec.md](./spec.md) §3、[项目全景说明.md](./项目全景说明.md) §6.2 |
| 修改交互（图谱、学习闭环、助手） | [功能说明.md](./功能说明.md)、相关 `plans/`、[未完成任务清单.md](./未完成任务清单.md) |
| 完成任务 / 新增任务 | [未完成任务清单.md](./未完成任务清单.md)（状态 + 变更记录 + 证据） |
| 界面改版 | [images/](./images) 重拍 + [项目全景说明.md](./项目全景说明.md) §10 图注 |
| 依赖或框架版本变化 | [项目全景说明.md](./项目全景说明.md) §2.1、[快速开始.md](./快速开始.md) §1 |
| 页面 / API / 数据模型 / 核心机制变化 | [handoff/project-dossier.md](./handoff/project-dossier.md) 对应章节；重新运行 `node handoff/build-index.mjs` 生成 HTML |

## 5. 提交前自检

```bash
# 1) 文档内相对链接是否都存在（PowerShell，在仓库根执行）
Get-ChildItem docs -Recurse -Filter *.md | ForEach-Object {
  $dir = $_.DirectoryName
  Select-String -Path $_.FullName -Pattern '\]\(([^)#]+\.md)' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } |
    ForEach-Object { if (-not (Test-Path (Join-Path $dir $_))) { "BROKEN: $($_.Path) -> $_" } }
}

# 2) 文档命令与代码一致性
npm run typecheck && npm run lint && npm run test

# 3) 截图目录与实际引用是否对齐
Select-String -Path docs\项目全景说明.md -Pattern 'images/[0-9]{2}-[a-z-]+\.png' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```

要求：无 `BROKEN` 输出；截图引用与 `docs/images/` 实际文件一致；命令均可在本仓库执行通过。

## 6. 归档策略

- 触发条件：方案已全部交付且被新方案替代 / 审计结论已被修复 / 内容与当前实现整体不符。
- 归档动作：移动到 `docs/archive/`，在文件顶部加：

```markdown
> **归档说明**：本文档为历史快照（原路径 `docs/xxx.md`），内容不再维护。
> 现行文档见 [../README.md](../README.md) 等。
```

- 归档文档中的历史链接允许失效，但需在归档横幅中说明替代文档，避免读者沿旧链接迷路。

### 6.1 本次归档记录（2026-11-02）

以下文件从 `docs/` 根目录移动至 `docs/archive/`，均为「已被 `plans/` 或现行文档取代」的历史快照，内容原样保留；带归档横幅的正式历史快照不在此表内（见 §6.2）。

| 原路径 | 归档路径 | 原因 |
|---|---|---|
| `docs/graph-performance-plan.md` | `archive/graph-performance-plan-根目录旧版-2026-11-02.md` | 与 `plans/graph-performance-plan.md` 重复，根目录版本更旧 |
| `docs/knowledge-universe-tasks.md` | `archive/knowledge-universe-tasks-根目录旧版-2026-11-02.md` | 与 `plans/knowledge-universe-tasks.md` 重复且更旧 |
| `docs/llm-optimization-plan.md` | `archive/llm-optimization-plan-根目录旧版-2026-11-02.md` | 与 `plans/llm-optimization-plan.md` 重复且更旧 |
| `docs/systematic-iteration-plan.md` | `archive/systematic-iteration-plan-根目录旧版-2026-11-02.md` | 与 `plans/systematic-iteration-plan.md` 重复且更旧 |
| `docs/ux-optimization-plan.md` | `archive/ux-optimization-plan-根目录旧版-2026-11-02.md` | 与 `plans/ux-optimization-plan.md` 重复且更旧 |
| `docs/visual-iteration-plan.md` | `archive/visual-iteration-plan-根目录旧版-2026-11-02.md` | 与 `plans/visual-iteration-plan.md` 重复且更旧 |
| `docs/knowledge-universe-roadmap.md` | `archive/knowledge-universe-roadmap-2026-11-02.md` | 路线图已被 `plans/knowledge-universe-tasks.md` 取代 |
| `docs/graph-star-cluster-layout.md` | `archive/graph-star-cluster-layout-2026-11-02.md` | Star/Cluster 布局实验记录，已并入图谱计划 |
| `docs/obsidian-gap-analysis.md` | `archive/obsidian-gap-analysis-2026-11-02.md` | 历史差距分析，结论已吸收进 `spec.md` / 台账 |

表中副本均未添加归档横幅（保留原始内容），替代关系以本表为准。

### 6.2 后续清理记录（2026-11-04）

11-02 归档时，有三份文档出现了「同一内容两份」的情况：一份是带归档横幅、被现行文档引用的正式历史快照，另一份是无横幅的原样副本。已删除无横幅、无引用的副本，保留正式快照：

| 已删除副本 | 保留的正式快照 | 引用该快照的现行文档 |
|---|---|---|
| `archive/GPT建议-根目录旧版-2026-11-02.md` | `archive/GPT建议.md` | `plans/knowledge-universe-tasks.md`、`plans/systematic-iteration-plan.md` |
| `archive/project-context-根目录旧版-2026-11-02.md` | `archive/project-context.md` | `plans/knowledge-universe-tasks.md`、`plans/systematic-iteration-plan.md` |
| `archive/排查-并入常见问题排查-2026-11-02.md` | `archive/排查-原始审计-2026-10-29.md` | `handoff/project-dossier.md` |

同时清理 `docs/images/` 中与 11-02 现行批重复的 11 张旧批截图（详见 [handoff/cleanup-report.md](./handoff/cleanup-report.md) §8），以及 `plans/frontend-quality-audit-evidence/` 中与全量结果逐键一致的 2 个 `*.partial.json` 过程文件。删除清单、判定依据与可恢复性见 [项目全景说明.md](./项目全景说明.md) §11。

上述副本删除前已备份至项目外临时目录；`docs/images/` 的 11 张 PNG 由 git 跟踪，可用 `git restore <路径>` 恢复；三份归档副本的原路径文件仍可由 `git show HEAD:<原路径>` 取回。
