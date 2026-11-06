# 个人知识库 · 项目交接说明（Project Dossier）

> 面向外部大模型 / 新接手者的单文件项目说明。内容以**当前磁盘工作区**为准，逐项标注来源路径；文档与代码冲突时以代码为准。
> 生成日期：2026-11-02 ｜ 分支：`master` ｜ HEAD：`c4c9591`（工作区含大量未提交改动，详见 §9） ｜ 语言：中文

---

## 0. 一句话结论

这是一个**单用户、跨设备的 Markdown 知识库 + 主动回忆 + 记忆度图谱**应用：导入 Markdown 后自动拆成“知识点（segment）”，阅读行为推进记忆曲线，首页每天给出 3 条可解释的复习建议，图谱按“记忆度亮度”着色，AI 仅做拆解/聚合/解释/问答且所有写操作都必须先预览再确认。

它要解决的是 Obsidian 类本地笔记的四个痛点：知识锁在本地、不会自动关联、看过不等于会了、不知道今天该复习什么。来源：[README.md](../../README.md#L1-L17)、[docs/功能说明.md](../功能说明.md#L1-L218)。

---

## 1. 项目定位与核心问题

| 问题 | 本项目的解法 | 主要实现 |
|---|---|---|
| 知识在本地，跨设备同步收费 | Vercel 部署，浏览器访问；Neon 存结构化数据，R2 备份原文 | `src/db/`、`src/lib/r2.ts` |
| 打开应用不知道学什么 | 首页 3 条确定性推荐：错题 → 到期复习 → 最近读过未测 → 新知识 | `src/lib/learning-plan.ts:70-130` |
| 看过不等于会了 | “先作答、再揭晓、后自评”的主动回忆，记录真实掌握结果 | `src/app/study/[segmentId]/page.tsx`、`src/app/api/learning/*` |
| 归类/关联靠手动 | 导入时提取 frontmatter 标签、行内 `#标签`、`[[双链]]`，自动建 wiki/tag/doc 三类边 | `src/lib/markdown.ts`、`src/lib/links.ts` |
| 图谱看不出哪些快忘了 | 节点亮度 = 记忆度，大小 = 关联数；支持搜索、聚焦、路径、主题 | `src/components/graph/*`、`src/lib/graph/*` |
| 长文阅读易失去耐心 | 按 `##`/`###`/`####` 结构化拆解，超长才按句子边界降级，代码块/表格不切 | `src/lib/splitter.ts:16-51` |

**不做的事（当前边界）**：多用户/注册、PDF/DOCX/网页剪藏、图片附件渲染、正式测验判分、向量检索（pgvector）。这些在 Roadmap/决策项中，见 §9。

---

## 2. 技术栈、运行与部署

### 2.1 版本（以 `package.json` 为准）

| 层 | 技术 / 版本 | 说明 |
|---|---|---|
| 框架 | Next.js `16.4.3`（App Router、Turbopack、Cache Components） | `partialPrefetching: true`、`cacheComponents: true`（`next.config.ts:19-23`） |
| UI | React `19.3.0`、Tailwind CSS `4`（`@tailwindcss/postcss 4.3.3`） | 无组件库，自写样式 |
| 图谱 | `react-force-graph-2d 1.29.2` | Canvas 力导向图 |
| 数据 | Neon Serverless Postgres `@neondatabase/serverless 1.2.0` + Drizzle ORM `0.45.4` | HTTP 驱动，无连接池常驻 |
| 对象存储 | Cloudflare R2（AWS S3 SDK `3.1156.0`） | 可选，仅备份导入原文 |
| Markdown | `react-markdown 10.1.0` + `remark-gfm 4.0.1` | 阅读渲染 |
| 工具 | `js-yaml 5.5.0` | frontmatter 解析 |
| 测试 | Vitest `5.0.5`、Playwright `1.64.1` | 单测 + 浏览器回归 |
| 运行环境 | Node.js `22.x`（本机实测 22.20.0） | `db:migrate` 依赖 `node --env-file=` |

### 2.2 命令（`package.json:5-20`）

```bash
npm install
npm run dev            # 开发，默认 http://localhost:3000
npm run build          # 生产构建
npm run start          # 生产启动
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test           # Vitest 单测
npm run test:e2e       # Playwright（scripts/run-e2e.mjs 自动起 dev server）
npm run perf:graph     # 图谱压测（scripts/measure-graph.mjs）
npm run db:migrate     # 顺序执行 src/db/migrations/*.sql
npm run db:migrate:check  # 只读检查（--dry-run）
npm run db:generate    # drizzle-kit generate
npm run db:push        # drizzle-kit push
npm run db:studio      # Drizzle Studio
```

Windows 上若页面停在骨架屏不水合，改用 `npm run dev -- --hostname 127.0.0.1 --port 3300`；Next 16 单项目同时只允许一个 dev server。来源：[docs/快速开始.md](../快速开始.md#L57-L66)。

### 2.3 环境变量（仅列名称，敏感值不写入本文）

| 变量 | 必填 | 用途 |
|---|---|---|
| `DATABASE_URL` | 是 | Neon **Pooled** 连接串，含 `?sslmode=require` |
| `AUTH_PASSCODE` | 是 | 单口令登录；未配置时全站 503/跳登录 |
| `SETTINGS_ENCRYPTION_KEY` | 否 | 加密 DB 中的 LLM API Key；缺省时从 `AUTH_PASSCODE` 派生 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 否 | R2 原文备份；缺省时导入仍可用，只是不备份 |
| `LLM_API_KEY` + `LLM_MODEL` | 否 | LLM 回退配置（设置页未配置时生效） |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 否 | 只给 Key 时模型缺省 `deepseek-v4-flash`，可用 `DEEPSEEK_MODEL` 覆盖 |

来源：[.env.example](../../.env.example#L1-L26)、`src/lib/llm.ts:109-137`、`src/lib/r2.ts:3-7`。

**LLM 配置优先级**：数据库 `app_settings.llm` → `LLM_API_KEY + LLM_MODEL` → `DEEPSEEK_API_KEY`（模型用 `DEEPSEEK_MODEL` 或默认值）。DB 读失败且无 env 回退时返回 `db-down`，与“确实未配置”区分。来源：`src/lib/llm.ts:105-137`。

### 2.4 部署

- 目标：Vercel Hobby + Neon + 可选 R2。`DATABASE_URL`、`AUTH_PASSCODE` 必配；`R2_*`、`LLM_*` 可选。
- 首次部署后执行 `npm run db:migrate`；迁移执行器 `scripts/apply-migrations.mjs` 用 `_kb_migrations` 记录版本，旧库自动建立基线。
- 已知上限：Vercel Hobby 请求体约 4.5MB，超大 Markdown 建议分次导入。来源：[README.md](../../README.md#L126-L133)。

---

## 3. 目录与模块地图

```
src/
├── proxy.ts                  # 全站登录门（Next Proxy/Middleware）
├── app/
│   ├── layout.tsx            # 根布局，AppShell 包裹
│   ├── page.tsx              # 今日学习 / 概览
│   ├── ask/                  # AI 助手（SSE）
│   ├── graph/                # 知识宇宙（全屏图谱）
│   ├── import/               # 导入
│   ├── login/                # 登录
│   ├── notes/ + notes/[id]/   # 文档列表 / 连续阅读
│   ├── segments/[id]/        # 知识点详情
│   ├── study/[segmentId]/    # 主动回忆
│   ├── progress/             # 学习复盘
│   ├── settings/             # 设置
│   ├── manifest.ts           # PWA manifest（未跟踪的新文件）
│   └── api/                  # 30 个 route.ts，37 个 HTTP 方法
├── components/               # 页面级与通用 UI
│   └── graph/                # 图谱专用组件
├── db/
│   ├── schema.ts             # 9 张表
│   ├── index.ts              # Neon 惰性连接
│   └── migrations/           # 0000–0007，共 8 个 SQL
├── lib/
│   ├── graph/                # 15 个图谱纯函数模块
│   ├── __tests__/            # Vitest 单测
│   └── ai/                   # ask 上下文等
scripts/                      # run-e2e / apply-migrations / gen-graph-data / measure-graph / mock-llm
e2e/                          # auth-graph.spec.ts
public/fixtures/              # graph-small/mid/large 压测数据（gitignore）
docs/                         # 现行文档 + plans/ + archive/ + handoff/
```

### 3.1 关键 lib 模块

| 模块 | 职责 |
|---|---|
| `lib/splitter.ts` | Markdown → 知识点结构化拆解（标题层级、句子边界、代码/表格原子块） |
| `lib/markdown.ts` | frontmatter、行内标签、`[[双链]]` 提取，`stripMarkdown` |
| `lib/links.ts` | 重建 wiki/tag/doc 三类边；同事务更新 `segment_count` |
| `lib/memory.ts` | 记忆曲线：稳定度推进、记忆度衰减、档位/配色 |
| `lib/learning-plan.ts` | 今日推荐排序、1/3/7 天复习调度、周指标 |
| `lib/learning-service.ts` | 今日/周报数据装配 |
| `lib/recall-question.ts` | 出题（LLM fast 档 / 缓存 / 原文复述降级） |
| `lib/annotations.ts` + `annotation-migrate.ts` | 标注锚定与三段内容变更后的迁移/重定位 |
| `lib/rag.ts` | 零依赖检索：分词 + SQL ILIKE/标签 + 纯函数评分 + 1-hop 邻居 |
| `lib/llm.ts` / `llm-calls.ts` / `llm-cache.ts` | DeepSeek OpenAI 兼容调用、流水、24h 缓存、日 token 护栏 |
| `lib/ai-split.ts` | 语义拆解/聚合 prompt 与输出校验 |
| `lib/agent-tools.ts` | 助手三工具（search/read/propose）与动作校验 |
| `lib/auth.ts` / `api.ts` / `security.ts` / `login-rate-limit.ts` | 会话、guard、开放重定向防护、登录限流 |
| `lib/cache.ts` / `db-retry.ts` / `db-read.ts` / `db-batch.ts` | 进程内 TTL 缓存、瞬时故障重试、陈旧快照、Neon batch 事务 |
| `lib/r2.ts` | 原文上传/补偿删除 |
| `lib/app-settings.ts` / `secret-crypto.ts` | 设置读写、API Key AES-GCM 加密 |

---

## 4. 数据模型（以 `src/db/schema.ts` 与迁移为准）

数据库共 **9 张表**。所有主键为 UUID（`app_settings`/`llm_cache` 为 text）。来源：`src/db/schema.ts:15-177`。

### 4.1 `documents`（导入的文档）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | uuid PK | 文档 id |
| `title` | text | 标题（手填 / 文件名 / frontmatter / 首个标题） |
| `source` | text | `paste` 或 `file`，默认 `paste` |
| `filename` | text? | 原始文件名 |
| `storage_key` | text? | R2 对象键；未配置 R2 时为空 |
| `tags` | text[] | 文档级标签 |
| `segment_count` | integer | 知识点数（写入时重建） |
| `created_at` | timestamptz | 创建时间 |

### 4.2 `segments`（知识点，最小学习单元）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | uuid PK | 知识点 id |
| `document_id` | uuid FK → documents（级联删除） | 所属文档 |
| `title` / `content` | text | 标题 / Markdown 正文 |
| `heading_path` | text | 标题路径，如 `基础篇 > 索引原理` |
| `order_index` | integer | 文档内顺序 |
| `tags` | text[] | 段级标签（含 frontmatter + 行内标签） |
| `view_count` | integer | 打开次数（<5 秒也计） |
| `first_viewed_at` / `last_viewed_at` | timestamptz? | 首次/最近有效阅读 |
| `stability` | real | 记忆稳定度（天），0 = 从未有效阅读 |
| `reading_ms` | bigint | 累计有效阅读毫秒 |
| `summary` | text? | 30 字 LLM 摘要（懒生成并落库） |
| `created_at` | timestamptz | 创建时间 |

索引：`segments_document_idx(document_id)`。

### 4.3 `links`（知识点关联边）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | uuid PK | 边 id |
| `from_id` / `to_id` | uuid FK → segments（级联） | 起点/终点 |
| `kind` | text | `wiki`（`[[双链]]`）/ `tag`（共同标签）/ `doc`（同文档相邻） |
| `weight` | real | wiki=1；tag=`共同标签数/3`（≤1）；doc=0.3 |

唯一索引：`links_unique(from_id, to_id, kind)`。来源：`src/lib/links.ts:22-79`。

### 4.4 `annotations`（划线/笔记）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | uuid PK | 标注 id |
| `segment_id` | uuid FK → segments（级联） | 所属段 |
| `kind` | text | `highlight`（仅划线）/ `note`（笔记；`quote` 为空 = 节级笔记） |
| `quote` | text? | 渲染文本中的引文 |
| `occurrence` | integer | 引文在段内第几次出现（默认 1） |
| `prefix` / `suffix` | text? | 前后文快照，用于模糊重定位 |
| `note` | text? | 笔记内容 |
| `color` | text | 默认 `amber` |
| `created_at` / `updated_at` | timestamptz | 时间 |

索引：`annotations_segment_idx(segment_id)`。

### 4.5 `reading_events`（有效阅读流水）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` / `segment_id` | uuid | 事件 / 段 |
| `started_at` | timestamptz | 开始时间 |
| `duration_ms` | integer | 停留毫秒（单次 ≥5 秒才写） |

索引：`reading_events_segment_idx`、`reading_events_started_idx`。

### 4.6 `recall_reviews`（主动回忆记录）

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | uuid PK | 记录 id |
| `submission_id` | text UNIQUE | 客户端提交幂等键（UUID） |
| `segment_id` | uuid FK | 知识点 |
| `question` / `reference_answer` / `answer` | text | 题目 / 参考答案 / 用户回答 |
| `result` | text | `incorrect` / `partial` / `correct` |
| `source_version` | text | 题目对应的内容版本（SHA-256(title+content)） |
| `reviewed_at` | timestamptz | 作答时间 |
| `next_review_at` | timestamptz? | 下次复习时间（1/3/7 天后） |

索引：`recall_reviews_submission_idx`（唯一）、`segment_idx`、`reviewed_idx`、`next_idx`。

### 4.7 `app_settings`（应用键值设置）

`key` text PK，`value` jsonb，`updated_at`。已知 key：`llm`（`{apiKey, model, fastModel}`，API Key 加密后存）、`learner`（学习者自述）。API Key 只在服务端使用，GET 不回明文。

### 4.8 `llm_cache`（LLM 输出缓存）

`hash` text PK（`sha256(kind|model|指纹)`）、`kind`（`split`/`aggregate`/`ask`/`recall-question` 等）、`output` jsonb、`model`、`expires_at`、`created_at`。上限 256 条，过期视为未命中。来源：`src/lib/llm-cache.ts:2-49`。

### 4.9 `llm_calls`（调用流水 / 可观测）

`id`、`kind`（`ask`/`ask-agent`/`split`/`aggregate`/`import-split`/`summary`/`test`/`recall-question`）、`model`、`in_tok`、`out_tok`、`ms`、`cached`（0/1）、`error`（≤200 字）、`created_at`。**只记维度与用量，不记 prompt / 画像文本**。来源：`src/db/schema.ts:159-176`、`src/lib/llm-calls.ts:2-36`。

### 4.10 迁移

`src/db/migrations/` 共 8 个：`0000_init` → `0001_fearless_lightspeed` → `0002_funny_tomorrow_man` → `0003_charming_selene` → `0004_vengeful_union_jack` → `0005_skinny_war_machine` → `0006_llm_calls_observability` → `0007_wooden_wong`。

---

## 5. 页面与交互流程

| 路由 | 职责 | 主要接口 | 关键组件 / 文件 |
|---|---|---|---|
| `/login` | 口令登录，成功后按 `safeNextPath()` 跳站内路径，默认 `/graph` | `POST /api/auth/login` | `src/app/login/page.tsx` |
| `/` | 今日学习 3 条推荐 + 记忆档位 + 今日阅读 + 薄弱 Top3 + 未读精选 + 最近导入 | `GET /api/stats`、`GET /api/learning/today` | `DashboardPanel.tsx`、`TodayLearningPanel.tsx` |
| `/graph` | 全屏“知识宇宙”：搜索、聚焦、路径、主题、小地图、详情面板 | `GET /api/graph` 或 `/fixtures/*.json` | `KnowledgeUniverse.tsx`、`GraphCanvas.tsx` 等 |
| `/notes` | 文档列表，按标题/标签过滤，显示段数与平均记忆度 | `GET /api/notes` | `src/app/notes/page.tsx` |
| `/notes/[id]` | 文档连续阅读：目录 + 段级灯点 + 划线/笔记 + 阅读计时上报 | `GET /api/notes/[id]`、`/annotations`、`POST /segments/[id]/view` | `src/app/notes/[id]/page.tsx` |
| `/segments/[id]` | 知识点详情：正文、记忆、出入链、编辑/删除/移动/摘要/标注/AI 拆解聚合；支持 `#edit` 深链 | `GET/PATCH/DELETE /api/segments/[id]` 等 | `src/app/segments/[id]/page.tsx`、`SegmentEditCard.tsx` |
| `/study/[segmentId]` | 主动回忆：出题 → 作答 → 揭晓 → 三档自评 → 写调度 | `POST /api/learning/question`、`/reviews` | `src/app/study/[segmentId]/page.tsx` |
| `/progress` | 7 天结论、14 天热力图、前后 7 天对比、下一步优先项 | `GET /api/learning/weekly` | `src/app/progress/page.tsx` |
| `/ask` | 知识库助手：SSE 流式、工具检索、改动确认卡；支持 `?segment=` / `?path=` 深链 | `POST /api/ai/ask`、`GET /api/ai/config` | `src/app/ask/page.tsx`、`AiOverlay.tsx` |
| `/import` | 上传 `.md` 或粘贴；三档粒度、可选 AI 语义拆分 | `POST /api/notes` | `src/app/import/page.tsx` |
| `/settings` | DeepSeek Key（只显尾号）、主/fast 模型、学习者自述、连接测试、近 7 天用量 | `GET/POST /api/settings`、`/ai/config`、`/ai/test`、`/ai/usage` | `src/app/settings/page.tsx` |

### 5.1 页面串联

1. 登录 → 默认 `/graph`（图谱是全站主入口）。
2. `/graph` 单击节点打开详情面板；双击或“阅读知识”进 `/segments/[id]`；“开始复习”进 `/study/[id]`；“编辑”进 `/segments/[id]#edit`。
3. `/` 的推荐卡片直接进 `/study/[segmentId]`；“导入知识”进 `/import`。
4. `/notes` → `/notes/[id]` 连续阅读 → 段标题/灯点跳 `/segments/[id]`。
5. `/ask` 可从任意页面通过 `?segment=` / `?path=` 带入上下文；回答中的改动提议由前端确认卡落到 apply 端点。
6. `/progress` 只读聚合，无定时任务/快照表。

来源：[docs/功能说明.md](../功能说明.md#L24-L219)、`src/components/AppShell.tsx`、`src/app/layout.tsx`。

### 5.2 布局与导航

- 桌面：左侧 56px 悬浮竖向图标栏；移动端（`<md`）：底部横向条。
- `/graph` 为沉浸页：隐藏全站导航与页脚，`100dvh` 占满视口。
- `/login` 不渲染外壳。
- PWA：`src/app/manifest.ts` + `public/icon-*.png`（当前为未跟踪新文件）。

来源：`src/components/AppShell.tsx`、`src/components/graph/GraphNavigation.tsx`、`src/app/layout.tsx`。

---

## 6. API 清单（30 个 route.ts，37 个方法）

> 所有业务 API 默认经 `guard(req)`：未登录返回 401；`proxy.ts` 在页面层也做全站拦截。除 `auth` 外均需 `kb_session`。来源：`src/lib/api.ts`、`src/proxy.ts:4-40`。

| 方法 | 路径 | 用途 | 关键入参 / 出参 |
|---|---|---|---|
| POST | `/api/auth/login` | 口令登录，写 `kb_session`（HttpOnly，30 天） | 入：`{passcode}`；`next` 由前端读取并用 `safeNextPath()` 跳转；失败限流 5 次/10 分钟 |
| POST | `/api/auth/logout` | 清 Cookie | — |
| GET | `/api/stats` | 概览统计 | 出：`total`、`byTier`、`readToday`、`recentDocuments`、`suggestion`、`weakTop3`、`unreadTop3` |
| GET | `/api/learning/today` | 今日 3 条推荐 + 周指标 | 出：`items[]`（含 `reasonCode`/`reason`）、`metrics`、`generatedAt` |
| POST | `/api/learning/question` | 出题 | 入：`{segmentId}`；出：`question`、`referenceAnswer`、`sourceVersion`、`generatedBy`（ai/cache/fallback） |
| POST | `/api/learning/reviews` | 记录回忆结果并排复习 | 入：`submissionId`、`segmentId`、`question`、`referenceAnswer`、`answer`、`result`、`sourceVersion`；出：`review`、`duplicate` |
| GET | `/api/learning/weekly` | 学习周报 | 出：`summary`、`current`/`previous` 指标、`days[]`、`priorityItems[]` |
| GET | `/api/notes` | 文档列表 + 平均记忆度 | 出：`{documents[{id,title,source,tags,segmentCount,createdAt,avgMemory}]}` |
| POST | `/api/notes` | 导入 Markdown | 入：`{title?,content,source?,filename?,maxChars?,aiSplit?}`；出：文档、段数、AI 拆分成功/失败数 |
| GET | `/api/notes/[id]` | 文档详情（阅读视图） | 出：`{document,segments[{id,title,headingPath,tags,viewCount,content,memory}]}` |
| PATCH | `/api/notes/[id]` | 改文档标题/标签 | 入：`{title?,tags?}` |
| DELETE | `/api/notes/[id]` | 删文档（级联段/边/标注；尝试删 R2 原文） | — |
| POST | `/api/notes/[id]/segments` | 文档内新增知识点 | 入：`{title,content,tags?,afterIndex?}` |
| GET | `/api/notes/[id]/annotations` | 文档全部标注 | 出：按段分组的标注 |
| GET | `/api/segments/[id]` | 知识点详情 + 结构化关系 | 出：段、出入链、上一/下一节、共同标签、原始边 |
| PATCH | `/api/segments/[id]` | 编辑标题/正文/标签/摘要 | 入：`{title?,content?,tags?,summary?}`；同事务重建边 + 迁移标注 |
| DELETE | `/api/segments/[id]` | 删知识点 | 级联边/标注/流水 |
| POST | `/api/segments/[id]/move` | 上移/下移 | 入：`{direction:'up' 或 'down'}`；重建 doc 链 |
| GET | `/api/segments/[id]/summary` | 30 字摘要（懒生成并落库） | 出：`{summary,cached?}` |
| POST | `/api/segments/[id]/view` | 上报阅读停留 | 入：`{durationMs,startedAt?}`；≥5 秒写 `reading_events` 并推进稳定度 |
| GET | `/api/segments/[id]/annotations` | 段标注列表 | — |
| POST | `/api/segments/[id]/annotations` | 新建划线/笔记 | 入：`kind`、`quote`、`occurrence`、`prefix/suffix`、`note`、`color` |
| DELETE | `/api/annotations/[id]` | 删除标注 | — |
| GET | `/api/graph` | 图谱数据 | 出：`{nodes[{id,title,memory,viewCount,readingMs,documentTitle,tags,summary,headingPath}],edges[{source,target,kind,weight}]}` |
| GET | `/api/settings` | 设置回显（Key 只回尾号） | 出：`configured`、`model`、`fastModel`、`keyTail`、`learnerDeclaration` |
| POST | `/api/settings` | 保存 LLM 配置 + 学习者自述 | 入：`{apiKey?,model?,fastModel?,learnerDeclaration?}`；空 Key = 不修改 |
| GET | `/api/ai/config` | LLM 是否可用 | 出：`{configured,model,fastModel}`（不含 Key） |
| POST | `/api/ai/test` | 测试连接（可带草稿，不落库） | 入：`{apiKey?,model?,fastModel?}` |
| GET | `/api/ai/usage` | 近 7 天用量 | 出：调用数、缓存命中、token、平均耗时、失败数 |
| POST | `/api/ai/ask` | 助手 SSE 流式回答 | 入：`{query,history?≤10,context?{segmentIds≤4}}`；`text/event-stream` |
| POST | `/api/ai/explain` | 解释选中文本 | 入：`{segmentId,quote?,...}`；只基于所在段 + 邻居 + 画像 |
| POST | `/api/ai/connect` | 联系两个概念 | 入：`{aId,bId}`（或两个 segmentId）；出共同点/差异/联系场景 |
| POST | `/api/ai/split-preview` | 语义拆解预览（只出 JSON） | 入：`{segmentId}`；出：2–8 个 `children[{title,content}]` + `contextUsed` |
| POST | `/api/ai/split-apply` | 应用拆解（用户确认后） | 入：`{segmentId,children}`；同事务更新/插入/迁移标注/重建边 |
| POST | `/api/ai/aggregate-preview` | 语义聚合预览（同文档 2–20 段 → 1 段） | 入：`{segmentIds[]}`；出融合稿 |
| POST | `/api/ai/aggregate-apply` | 应用聚合 | 入：`{segmentIds, merged:{title,content}}`；同事务更新首段/删除其余/迁移标注 |
| GET | `/api/learner-profile` | 学习者画像（派生 + 缓存） | 出：画像/声明块 |

> 说明：`/api/segments/[id]/summary` 是 **GET**（源码 `summary/route.ts:41`），不是 POST。`/api/annotations/[id]` 只有 DELETE。

---

## 7. 核心机制

### 7.1 导入与拆分

1. **入口**：`POST /api/notes`（`src/app/api/notes/route.ts:109-140`）。
2. **结构化拆分**：`splitMarkdown` 只以 `##` 开新知识点；`###/####` 连同标题行并入父节；父节超 `maxChars` 才在子标题边界二次拆分；`<minChars` 的碎片并入前一组；超长段落按句子、列表按条目降级；代码围栏/表格为原子块，绝不内部切分；单句超限整体保留。默认 `maxChars=1800`、`minChars=300`，API 将 `maxChars` 限制在 300–4000。来源：`src/lib/splitter.ts:9-51`、`src/app/api/notes/route.ts:118-125`。
3. **元数据**：YAML frontmatter（`title`/`tags`）→ 行内 `#标签` → `[[目标|别名]]` 双链。来源：`src/lib/markdown.ts:12-68`。
4. **可选语义拆分**：`aiSplit=true` 且 LLM 可用时，只处理超过 `maxChars` 的段（按长度降序，每篇至多 5 段），并发 ≤2；单段失败/超时降级保留结构拆分结果，绝不阻断导入。来源：`src/app/api/notes/route.ts:127-140`、`src/lib/ai-split.ts:22-94`。
5. **原子写**：文档、段、wiki/tag/doc 边、`segment_count` 通过 `runBatch`（Neon `db.batch`）在同一事务提交；失败整体回滚。R2 先上传原文，DB 失败则补偿删除。来源：`src/lib/db-batch.ts`、`src/app/api/notes/route.ts`。

### 7.2 双链 / 标签 / 同文档关联

- `wiki`：扫描段正文 `[[标题]]`，按标题（大小写不敏感、trim）匹配其他段，权重 1。
- `tag`：段标签与文档标签合并后取交集，权重 `min(1, 共同标签数/3)`。
- `doc`：同文档按 `order_index, created_at, id` 排序后的相邻段，权重 0.3。
- 编辑段内容/标签时，在同一个 batch 内删除并重建该段参与的 wiki/tag 边；文档段序变化时重建 doc 链与 `segment_count`。来源：`src/lib/links.ts:12-87`。

### 7.3 记忆度与复习调度

**记忆度**：`M(t) = exp(-Δt / S)`，`Δt` 为距最近有效阅读的天数，`S` 为稳定度（天）。不落库，读取时现算。

**稳定度推进**（`src/lib/memory.ts:11-30`）：

| 参数 | 值 | 含义 |
|---|---|---|
| `FIRST_READ_BASE` | 0.3 天 | 首次阅读基础稳定度 |
| `FIRST_READ_GAIN` | 0.5 | 首次阅读加成（× 时长权重） |
| `INTERVAL_EFFECT_CAP` | 1.6 | 间隔效应封顶 |
| `STABILITY_CAP_DAYS` | 365 | 稳定度上限 |
| `FULL_WEIGHT_MINUTES` | 3 分钟 | 时长权重满分 |
| `MIN_WEIGHT` / `MAX_WEIGHT` | 0.2 / 1 | 时长权重上下限 |
| `MAX_SESSION_MS` | 10 分钟 | 单次有效时长封顶（防挂机） |
| `MIN_EVENT_MS` | 5 秒 | 低于此只计 `view_count`，不推进稳定度 |

**档位**：`unread`（未读，M≤0）/ `weak`（微光，M<0.4）/ `medium`（明亮，0.4≤M<0.75）/ `strong`（长明，≥0.75）。来源：`src/lib/memory.ts:34-55`。

**复习调度**：`incorrect → 1 天`、`partial → 3 天`、`correct → 7 天`；`nextReviewAt(result, reviewedAt)`。来源：`src/lib/learning-plan.ts:8-12,50-52`。

**今日推荐**（确定性，无 LLM）：分类优先级 `previous-incorrect(0) → due-review(1) → continue-learning(2) → new-knowledge(3) → scheduled(4)`；`scheduled` 被过滤；类内按可解释字段排序（错题按最近作答、到期按 `nextReviewAt`、继续学习按最近阅读、新知识按创建时间），取 3 条。来源：`src/lib/learning-plan.ts:70-130`。

**幂等与内容版本**：`submissionId` 唯一；重复提交返回已有记录（`duplicate:true`）。题目与复习记录共用 `sourceVersion=SHA-256(title\n\0\ncontent)`；内容变化后旧题提交返回 409。来源：`src/app/api/learning/reviews/route.ts:27-53`、`src/lib/learning-plan.ts:54-57`。

### 7.4 图谱渲染

- 数据：节点=知识点（记忆度现算），边=wiki/tag/doc；默认 `GET /api/graph`；页面带 `?fixture=graph-small|mid|large` 时由前端直接加载 `/fixtures/*.json`（不经过 API，用于压测/E2E）。来源：`src/components/graph/KnowledgeUniverse.tsx:178-287`。
- 渲染：`react-force-graph-2d` Canvas；节点大小按 degree，亮度按记忆度（暗灰=未读，琥珀越亮越牢）。
- 交互：`Ctrl/Cmd+K` 搜索；单击 280ms 延迟确认并开详情；双击进阅读；右键/长按菜单（阅读、展开一阶、AI 解释、编辑、联系两概念）；双选“联系两概念”并可高亮最短路径；一阶/二阶聚焦 BFS 上限 300（只改视图不改数据）；学习地图四类标记（薄弱/到期/今日推荐/枢纽）；主题面板（环境 × 风格，存 localStorage）；小地图 168×112（默认关闭）。
- 性能：已有视口裁剪、同色批量绘制、quadtree、坐标持久化/低温度重热、Barnes-Hut theta 自适应、sprite 离屏缓存等；20k 节点实测约 3.4fps，渲染路线（社区聚合/WebGL/WASM）仍待决策。
- 来源：[docs/功能说明.md](../功能说明.md#L60-L108)、`src/components/graph/*`、`src/lib/graph/*`、[docs/未完成任务清单.md](../未完成任务清单.md#L482-L489)。

### 7.5 AI 能力与配置

| 能力 | 端点 | 是否写库 | 备注 |
|---|---|---|---|
| 语义拆解 | `POST /api/ai/split-preview` → `/split-apply` | preview 否；apply 是 | 2–8 子段；同事务迁移标注/重建边 |
| 语义聚合 | `POST /api/ai/aggregate-preview` → `/aggregate-apply` | preview 否；apply 是 | 同文档 2–20 段 → 1 段 |
| 解释这段 | `POST /api/ai/explain` | 否 | 所在段 + 1-hop 邻居 + 画像 |
| 联系两概念 | `POST /api/ai/connect` | 否 | 共同点/差异/联系场景 |
| 助手问答 | `POST /api/ai/ask`（SSE） | 仅确认后 apply | 工具：`search_knowledge` / `read_segment` / `propose_actions`；最多 3 轮工具；`propose_actions` 只提议 |
| 段摘要 | `GET /api/segments/[id]/summary` | 是（落库缓存） | 30 字 |
| 出题 | `POST /api/learning/question` | 否（缓存进 `llm_cache`） | LLM 不可用/失败 → 原文复述题 |
| 连接测试 | `POST /api/ai/test` | 否 | 可用草稿 Key/模型，不落库、不回显 |
| 用量 | `GET /api/ai/usage` | 否 | 近 7 天聚合 |

**调用约束**：DeepSeek 官方 base URL `https://api.deepseek.com`（OpenAI 兼容）；默认模型 `deepseek-v4-flash`；fast 档未配置时回退主模型；单次超时 60 秒；并发信号量 3；429/5xx/网络错误默认重试 1 次；日 token 护栏 500,000（按 `llm_calls` 当日累计，读失败 fail-closed）。来源：`src/lib/llm.ts:19-25,90-99`、`src/lib/llm-calls.ts:10,38-54`。

**缓存**：`llm_cache` key = `sha256(kind|model|指纹)`；ask 仅缓存“无工具、无改动提议”的直答（24h），split/aggregate 按内容指纹缓存；最多 256 条，过期按 `created_at` 清理。来源：`src/lib/llm-cache.ts:2-49`、`src/app/api/ai/ask/route.ts:16-31`。

**安全边界**：Agent 输出永不直接写库；`validateActions()` 校验类型白名单、UUID、长度；写操作只能由前端确认卡调用既有 PATCH/DELETE/POST 端点。`/api/ai/test` 不接受任意 `baseUrl`（防 SSRF）。来源：`src/lib/agent-tools.ts:14-167`、`src/lib/llm.ts:51-61`。

---

## 8. 约定与坑点

### 8.1 Next.js 16 相关（来自 `AGENTS.md`）

- **不要凭训练数据写 Next 16 代码**：本版本 API/约定/目录可能不同；写代码前先读 `node_modules/next/dist/docs/` 的相关指南，并遵守弃用提示。
- 该提示块由 `next dev` 自动写入/重建；不要从 diff 中删除它。
- 项目启用了 `cacheComponents: true` 与 `partialPrefetching: true`；页面数据获取方式与缓存语义需按该版本文档处理。来源：[AGENTS.md](../../AGENTS.md#L1-9)、`next.config.ts:19-23`。

### 8.2 认证 / 代理

- Cookie：`kb_session`，HttpOnly，30 天；token = `SHA-256("kb-v1:"+AUTH_PASSCODE)`，不落库、不加盐（泄露面等价于口令）。
- `src/proxy.ts` matcher 排除静态资源与图片后缀；`/login`、`/api/auth` 公开；未配置口令时代理层 API 503、页面跳登录（登录端点自身返回 500 并提示配置）；未登录 API 401、页面 302 到 `/login?next=...`。
- 登录限流：同一 IP（`x-forwarded-for` / `x-real-ip`）10 分钟窗口内 5 次失败后拒绝，返回 `retryAfterSec`。
- 登录后跳转经 `safeNextPath()`，只允许站内路径，防开放重定向。
- 来源：`src/lib/auth.ts:1-53`、`src/proxy.ts:4-40`、`src/lib/login-rate-limit.ts`、`src/lib/security.ts`。

### 8.3 缓存 / 重试 / 降级

- 进程内 TTL 缓存：默认 60 秒、容量 64、陈旧快照保留 15 分钟；**多实例/冷启动各自一份，不承担一致性**。`stats=60s`、`graph=60s`、`notes=60s`、`note:{id}=120s`、`learning-today` 新鲜 TTL=0（只保留 15 分钟陈旧快照）。来源：`src/lib/cache.ts`、各读路由。
- 读路径：`withDbRetry` 同请求内重试瞬时错误 → 仍失败用 `withStaleFallback` 回退上次成功快照，响应头 `X-Cache: STALE`；完全不可用返回 503，页面显示“重试”。写路径不走该降级。
- `runBatch` 用 Neon HTTP `db.batch` 在单个事务顺序执行；空数组不发请求。
- 来源：`src/lib/db-retry.ts`、`src/lib/db-read.ts:1-43`、`src/lib/db-batch.ts`。

### 8.4 已知性能 / 容量问题

- 图谱接口全量返回节点与边：历史审计记录 20k 节点约 7.75MB、61k 边；Canvas 解析与绘制会成为长任务，当前无服务端分页/社区聚合。来源：[docs/archive/排查-原始审计-2026-10-29.md](../archive/排查-原始审计-2026-10-29.md#L159)。
- 20k 节点实测约 3.4fps；社区聚合按需展开（B6）条件未触发，WebGL（B9）/WASM（B10）待决策。来源：[docs/未完成任务清单.md](../未完成任务清单.md#L482-L489)。
- Vercel Hobby 请求体约 4.5MB，超大 Markdown 需分次导入。
- LLM 未配置时 AI 端点返回 503/指引；`deepseek-v4-flash` 的 function calling 未实测，400 时自动降级为无工具直答（`mode:'agent-notools'`）。来源：`src/app/api/ai/ask/route.ts:29-30`。

### 8.5 标注坑点

- 锚点四元组 `quote/occurrence/prefix/suffix` 基于**渲染文本**（`stripMarkdown` 近似），不是原始 Markdown 偏移。
- 段内容编辑后三级重定位：精确匹配 occurrence → 唯一引文 → 前后文模糊 → 失效返回 `null`；拆解/聚合会迁移标注。来源：`src/lib/annotations.ts:2-85`、`src/lib/annotation-migrate.ts`。

### 8.6 其他约定

- 所有写操作（导入、段编辑/移动/删除、AI 拆解/聚合）尽量走同一 Neon batch 事务，保证业务数据、标注迁移、关系边、`segment_count` 一致。
- API 入参普遍做长度截断与 UUID 校验；错误统一 `badRequest`/`notFound`/`dbUnavailable`。
- 隐私：`llm_calls` 不记 prompt/画像；设置 GET 只回 Key 尾号；dossier/截图不得包含 `.env.local` 值。

---

## 9. 当前状态与未完成事项

### 9.1 代码与文档基线

- 当前分支 `master`，HEAD `c4c9591`（“解决手机适配问题”）。
- 工作区有大量未提交改动（`src/app`、`src/components`、`src/lib`、`playwright.config.ts`、5 份 docs），以及未跟踪的 PWA 图标/manifest、单测、`ai/ask-conversation.ts`、`graph-detail-cache.ts` 等。**交接包不修改这些业务改动**。
- `docs/未完成任务清单.md` 元信息仍写“HEAD `4b471d1` + 2026-10-29 改动”，与当前 `c4c9591` 不一致；引用该文档时需注意基线漂移。来源：[docs/未完成任务清单.md](../未完成任务清单.md#L3-L9)。
- `docs/README.md` 曾写“截图 19 张”，实际 `docs/images/` 有 31 个 PNG（15:34 旧批 15 张 + 15:55 现行批 16 张），已在本次整理中修正。

### 9.2 已完成基线（摘要）

- LLM：调用流水、token 预算、429/5xx 重试、导入并行拆分、ask 流式、fast 档、并发信号量、未配置文案区分。
- 图谱：渲染属性预计算、warmup、接口字段瘦身、拖拽重热、sprite 离屏缓存、视口裁剪、quadtree、坐标持久化、theta 自适应、tooltip 缓存、O(1) 命中。
- 安全/韧性：CSP、Key AES-GCM 加密、登录限流、开放重定向防护、迁移版本表、Neon batch 原子写、只读重试 + 陈旧快照、503 错误态。
- 学习闭环：主动回忆、1/3/7 天调度、周报/热力图、今日推荐。
- 来源：[docs/未完成任务清单.md](../未完成任务清单.md#L46-L100)。

### 9.3 开放决策项（4 个）

| 决策项 | 合并自 | 阻塞原因 | 解锁条件 |
|---|---|---|---|
| D1 主动回忆能力扩展 | A6 自测三问 + C1 正式测验 + 已交付 `/study` | 出题数/题型/判分/是否影响 stability 未定义 | 依据真实使用数据决定是否扩展 |
| D2 20k 图谱瓶颈诊断与渲染路线 | B6 社区聚合 + B9 WebGL + B10 WASM | 已有 20k≈3.4fps，但改动层级不同且需授权 | 先 profiling，再三选一立项 |
| D3 ask 答非所问抽样与检索路线 | A3 pgvector + 复杂 RAG | 需 20 问人工抽样；pgvector 打破“零新增依赖” | 完成抽样并记录结论 |
| D4 资料输入扩展 | C2 PDF/DOCX/网页剪藏 + C3 附件图片 | 需新解析依赖、R2 访问策略与生命周期 | 明确首个必要格式并批准依赖 |

来源：[docs/未完成任务清单.md](../未完成任务清单.md#L478-L491)。

### 9.4 体验类未完成

- G1–G27 视觉与体验迭代（信息架构、对比度、窄屏、组件统一）：状态“未开始”，见 [docs/plans/visual-iteration-plan.md](../plans/visual-iteration-plan.md)。任务总览行标注 P1、工作量假设 3.5–4.5 人日。
- Roadmap 未勾选：测验模式、更多导入格式（PDF/DOCX/网页剪藏）、附件与图片上传 R2。来源：[README.md](../../README.md#L135-L143)。

### 9.5 文档现状

`docs/` 已完成一次整理：`README.md` 为索引，`plans/` 放专项计划，`archive/` 放历史快照。本次交接又新增 `docs/handoff/`，并把根目录中已被 `plans/` 取代的旧版计划与历史分析移入 `archive/`（清单见 [cleanup-report.md](./cleanup-report.md)、[docs/README.md](../README.md)）。`docs/前端缺陷清单与修复方案.md` 为未跟踪的用户新文档，未移动。

---

## 10. 截图索引（真实运行界面）

采集参数：Chrome、viewport 1440×1000、deviceScaleFactor 2（原图 2880×2000）；本节图片为 1600px 宽 JPEG 副本，原图保留在 `docs/images/`。

| 图片 | 页面 / 观察点 |
|---|---|
| ![登录](screenshots/login.jpg) | `/login`：单口令登录，无注册入口。 |
| ![今日学习](screenshots/dashboard.jpg) | `/`：今日推荐、统计、薄弱清单、未读精选、最近导入。 |
| ![知识宇宙](screenshots/graph-overview.jpg) | `/graph`：全屏力导向图，节点亮度=记忆度，顶部统计与搜索。 |
| ![图谱搜索](screenshots/graph-search.jpg) | `/graph`：`Ctrl/Cmd+K` 搜索浮层与匹配结果。 |
| ![图谱详情](screenshots/graph-detail.jpg) | `/graph`：单击节点后的详情面板与操作入口。 |
| ![图谱双选](screenshots/graph-compare.jpg) | `/graph`：双选两个节点后的“联系两概念”对比。 |
| ![图谱主题](screenshots/graph-theme.jpg) | `/graph`：环境 × 风格主题面板实时预览。 |
| ![图谱大规模](screenshots/graph-large.jpg) | `/graph?fixture=graph-large`：大规模 fixture 的渲染形态。 |
| ![知识库](screenshots/notes-list.jpg) | `/notes`：文档列表、标签、段数、平均记忆度。 |
| ![文档阅读](screenshots/note-reading.jpg) | `/notes/[id]`：连续阅读、右侧目录、段级灯点、划线/笔记。 |
| ![知识点详情](screenshots/segment-detail.jpg) | `/segments/[id]`：正文、记忆状态、关系、编辑入口。 |
| ![学习复盘](screenshots/progress.jpg) | `/progress`：7 天结论、14 天热力、下一步优先项。 |
| ![主动回忆](screenshots/study-recall.jpg) | `/study/[segmentId]`：先作答，不显示原文。 |
| ![揭晓答案](screenshots/study-reveal.jpg) | `/study/[segmentId]`：揭晓参考答案与三档自评。 |
| ![AI 助手](screenshots/ask.jpg) | `/ask`：助手对话与上下文 chips。 |
| ![导入](screenshots/import.jpg) | `/import`：文件/粘贴、粒度三档、语义拆分开关。 |
| ![设置](screenshots/settings.jpg) | `/settings`：Key 尾号、主/fast 模型、学习者自述、用量。 |

---

## 11. 给外部大模型的使用建议

1. 先读 §0–§2 建立定位与技术栈，再读 §4 数据模型与 §6 API，最后按需读 §5/§7 的页面与机制。
2. 任何改动建议都要先核对源码路径；本 dossier 的结论均标注来源文件/行号，可逐条验证。
3. 不要把本 dossier 当作“最新提交”的绝对快照：工作区有未提交改动，关键结论以磁盘代码为准。
4. 涉及写操作时，牢记项目的硬约束：**LLM 不直接写库；preview → 用户确认 → apply；写操作尽量同事务**。

---

## 12. 主要来源文件

- [README.md](../../README.md)
- [docs/功能说明.md](../功能说明.md)
- [docs/配置说明.md](../配置说明.md)
- [docs/未完成任务清单.md](../未完成任务清单.md)
- [docs/项目全景说明.md](../项目全景说明.md)
- [docs/快速开始.md](../快速开始.md)
- `src/db/schema.ts`、`src/lib/*`、`src/app/api/**/route.ts`、`src/components/**`
- `package.json`、`.env.example`、`next.config.ts`、`AGENTS.md`
