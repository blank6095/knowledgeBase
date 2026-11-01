# 项目上下文说明（Project Context）

> **归档说明**：本文档原为 `docs/project-context.md`，是旧版单文件上下文（基线 `4b471d1`，2026-10-29），已被 [项目全景说明](../项目全景说明.md) 替代。
> 内容不再维护；现行文档入口见 [文档索引](../README.md)。

> **用途**：作为网页对话 AI 的常驻上下文，使其无需翻阅代码即可准确理解本项目。
> **用法**：整篇作为系统提示或首轮上下文注入；若与代码冲突，**以代码为准**，并回写本文档。
> **基线**：`master` 分支，HEAD `4b471d1`，2026-10-29 核实。

---

## 0. 一页速览

| 项 | 内容 |
|---|---|
| 名称 | 个人知识库（knowledge-base），v0.1.0，私有项目 |
| 一句话 | 跨设备访问、自动关联、按记忆程度着色的个人学习知识库，解决 Obsidian「本地锁定 + 手动关联 + 看不出遗忘」三个痛点 |
| 形态 | 单用户 Web 应用（无注册、无多租户），单口令登录 |
| 技术栈 | Next.js 16 App Router + React 19 + Tailwind 4；Neon Serverless Postgres + Drizzle；Cloudflare R2；DeepSeek（OpenAI 兼容） |
| 部署 | Vercel Hobby（个人非商业） |
| 数据规模假设 | 个人库，常规数千知识点；>8k 才需要考虑图谱聚合/WebGL |
| 工作语言 | 界面、注释、文档均为简体中文 |
| 最关键的 5 条铁律 | ①零新增依赖优先 ②LLM 输出永不直接写库（preview→确认→apply）③不记录 prompt 与画像原文 ④记忆度读取时现算不落库 ⑤单用户、key 只在服务端 |

---

## 1. 核心定位与业务目标

### 1.1 定位

面向**个人学习者**的自托管知识库：把 Markdown 笔记变成「可跨设备访问、自动建立关联、能感知遗忘」的学习系统。不做团队协作、不做公开分享、不做多用户权限。

### 1.2 要解决的具体痛点与对应解法

| 痛点（Obsidian 场景） | 本项目的解法 | 落点 |
|---|---|---|
| 知识锁在本地，跨设备需付费同步 | 部署 Vercel，浏览器即用 | 全站 |
| 归类与关联靠手动 | 导入自动提取 frontmatter 标签、正文 `[[双链]]`，自动生成三类边 | `src/lib/markdown.ts`、`src/lib/links.ts` |
| 图谱太大，看不出哪些快忘 | 节点亮度=记忆度（琥珀灯隐喻），可按记忆档位/关联类型过滤 | `src/app/graph/`、`src/lib/memory.ts` |
| 记忆保持没有反馈 | 阅读即学习：按停留时长推进稳定度，展示记忆度与半衰期 | `src/app/api/segments/[id]/view/route.ts` |
| 长文读不下去 | 导入按标题层级拆成合适粒度的知识点，不在句中截断 | `src/lib/splitter.ts` |

### 1.3 业务目标（隐含在设计与文档中的优先级）

1. **阅读优先**：一切交互以「打开就能读、读完有反馈」为准，AI 是增强不是入口。
2. **成本可控**：LLM 调用有预算、有缓存、有护栏、有可观测，个人免费额度可长期运行。
3. **隐私最小化**：不记 prompt、不记画像原文，key 只在服务端。
4. **零运维**：Serverless 三件套（Vercel + Neon + R2），无自建服务。

### 1.4 明确非目标

- 多用户、注册体系、团队协作、公开分享链接
- 移动原生 App
- 富文本/图片为主的笔记（图片仅 Roadmap）
- 通用聊天机器人（对话只服务本库内容）

---

## 2. 技术栈与架构

### 2.1 版本与选型（来自 `package.json`）

| 层 | 技术 | 版本 | 说明 |
|---|---|---|---|
| 框架 | Next.js | `16.4.3` | App Router；开启 `cacheComponents`、`partialPrefetching` |
| UI | React / React DOM | `19.3.0` | Server Components + 客户端交互组件 |
| 样式 | Tailwind CSS | `^4`（`@tailwindcss/postcss ^4.3.3`） | 无 `tailwind.config`，CSS-first |
| 语言 | TypeScript | `^5` | `npm run typecheck` 为 `tsc --noEmit` |
| 数据库驱动 | `@neondatabase/serverless` | `^1.2.0` | HTTP 驱动，支持 `db.batch` 事务 |
| ORM | `drizzle-orm` | `^0.45.4` | `neon-http` 适配器；`drizzle-kit ^0.31.11` 生成迁移 |
| 对象存储 | `@aws-sdk/client-s3` | `^3.1156.0` | 接 Cloudflare R2（S3 兼容）；列为 `serverExternalPackages` |
| 图谱 | `react-force-graph-2d` | `^1.29.2` | Canvas 力导向图 |
| Markdown | `react-markdown` + `remark-gfm` | `10.1.0` / `4.0.1` | 阅读态渲染 |
| YAML | `js-yaml` | `^5.5.0` | frontmatter 解析 |
| 单测 | Vitest | `^5.0.5` | 用例在 `src/lib/__tests__/`、以及组件测试；`vitest.config.mts` 限 `maxWorkers: 2`（Windows 默认并发会偶发 worker 启动超时，导致整套假失败） |
| E2E | Playwright | `^1.64.1` | `e2e/auth-graph.spec.ts` |
| Lint | ESLint 9 + `eslint-config-next` | `^9` / `16.4.3` | `npm run lint` |

**注意**：本仓库的 Next.js 16 与训练数据中的版本存在破坏性差异。改代码前必须读 `node_modules/next/dist/docs/` 对应指南（`AGENTS.md` 已写入此规则）。

### 2.2 运行时架构

```
浏览器
  │  Cookie: kb_session=sha256("kb-v1:"+AUTH_PASSCODE)  (HttpOnly, 30 天)
  ▼
src/proxy.ts  ── 全站登录门（Next 16 的 proxy，等价旧 middleware）
  │  /login、/api/auth/* 放行；未登录页面 302 /login?next=…，API 401；未配置口令 503
  ▼
App Router 页面（RSC + 客户端组件）  ⇄  /api/* Route Handlers（Node runtime）
  │                                         │
  │                    ┌────────────────────┼─────────────────────┐
  │                    ▼                    ▼                     ▼
  │              lib 业务层            Neon Postgres         Cloudflare R2
  │         (splitter/memory/links/    (HTTP 驱动，           (原文备份，
  │          rag/llm/annotations…)      db.batch 事务)         未配置则跳过)
  │                                         │
  │                                         ▼
  │                                   DeepSeek API
  │                            (raw fetch, OpenAI 兼容 /chat/completions)
```

要点：

- **无中间层服务**：业务逻辑全部在 `src/lib/*` 纯函数或查询构造器中，路由只做校验与编排。
- **数据库连接惰性初始化**：`next build` 会导入路由模块，故 `src/db/index.ts` 用 Proxy 延迟到首次查询才建立连接。
- **写操作原子性**：多表写入统一走 Neon HTTP batch（`src/lib/db-batch.ts`），失败整体回滚（无事务性连接，靠 batch 原子提交）。
- **缓存分两层**：进程内 TTL 缓存（`src/lib/cache.ts`，供 stats 等高频读）+ 数据库 LLM 输出缓存（`llm_cache` 表）。

### 2.3 部署形态与边界

| 项 | 现状 |
|---|---|
| 平台 | Vercel Hobby（免费，非商业） |
| 请求体上限 | 约 4.5MB（超大 Markdown 需分次粘贴） |
| 实例 | 可能多实例；进程内缓存写后失效只作用于当前实例（best-effort） |
| 环境变量 | `DATABASE_URL`、`AUTH_PASSCODE` 必填；`R2_*` 可选；`LLM_*`/`DEEPSEEK_*` 为回退 |
| 建表 | 部署后需手工执行一次 `npm run db:migrate` |

---

## 3. 目录结构

```
knowledge-base/
├── AGENTS.md                  # 仓库规则：Next 16 文档先行 + 提示词生成规范
├── README.md                  # 使用说明、Roadmap、已知限制
├── next.config.ts             # cacheComponents / partialPrefetching / 安全响应头
├── package.json
├── .env.example               # 环境变量模板与注释
├── docs/                      # 方案与治理文档（见 §12）
├── e2e/auth-graph.spec.ts     # Playwright 回归
├── scripts/
│   ├── apply-migrations.mjs   # 按 _kb_migrations 顺序执行迁移，支持 --dry-run
│   ├── gen-graph-data.mjs     # 生成与 /api/graph 同构的压测数据
│   ├── mock-llm.mjs           # E2E/单测用假模型服务
│   ├── perf-seed.mjs          # 压测灌数
│   └── run-e2e.mjs            # E2E 启动器（起服务 + 跑 Playwright）
└── src/
    ├── proxy.ts               # 认证网关（全站登录门）
    ├── db/
    │   ├── index.ts           # Neon 连接（Proxy 惰性初始化）
    │   ├── schema.ts          # 9 张表定义（Drizzle）
    │   └── migrations/        # 0000_init … 0007_wooden_wong.sql
    ├── lib/
    │   ├── splitter.ts        # Markdown → 知识点结构化拆解（启发式，主链路）
    │   ├── ai-split.ts        # LLM 语义拆解/聚合的 prompt 与解析
    │   ├── markdown.ts        # frontmatter、标签、[[双链]] 提取
    │   ├── memory.ts          # 记忆曲线：稳定度推进 / 记忆度衰减 / 档位与配色
    │   ├── links.ts           # wiki / tag / doc 三类边的重建 SQL
    │   ├── annotations.ts     # 标注锚定与三级重定位
    │   ├── annotation-migrate.ts # 段内容编辑后迁移标注
    │   ├── highlight.ts       # 划线渲染定位
    │   ├── rag.ts             # 关键词检索与片段抽取（非向量）
    │   ├── learner-profile.ts # 学习者画像（5 项 SQL 下推聚合，带缓存）
    │   ├── kb-overview.ts     # 知识库概览块（Agent 常驻上下文，≤600 字）
    │   ├── llm.ts             # DeepSeek 调用层（fetch/重试/预算/护栏/分档/流式）
    │   ├── llm-cache.ts       # LLM 输出缓存读写（sha256 key，256 条上限）
    │   ├── llm-calls.ts       # llm_calls 流水与日 token 护栏
    │   ├── agent-tools.ts     # 助手 Agent 工具定义 / 流式 tool_call 组装 / 动作校验
    │   ├── cache.ts           # 进程内 TTL 缓存 + 写后失效
    │   ├── db-batch.ts        # Neon HTTP batch 事务封装
    │   ├── app-settings.ts    # app_settings 读写（key='llm' / 'learner'）
    │   ├── auth.ts            # 会话令牌 / 口令校验 / Cookie 解析
    │   ├── login-rate-limit.ts# 登录失败限流
    │   ├── security.ts        # HTML 转义、安全跳转
    │   ├── api.ts             # guard / badRequest / notFound / isUuid
    │   ├── r2.ts              # R2 原文备份（S3 SDK 封装）
    │   ├── client.ts          # 浏览器侧 fetch 封装
    │   ├── db-retry.ts        # 数据库瞬时故障识别 + 指数退避重试（仅只读路径）
    │   ├── db-read.ts         # 读路径降级包装（失败回退陈旧快照）
    │   ├── ui/                # 表现层基础：contrast(对比度) / geometry(浮层碰撞) / theme(色值出口)
    │   ├── graph/             # graph-types / graph-state / click-intent / graph-search / graph-focus / graph-theme / graph-preferences / graph-map / graph-minimap(小地图投影)
    │   └── __tests__/         # Vitest 用例（memory/splitter/links/rag/llm/cache…）
    ├── components/
    │   ├── AppShell.tsx       # 全站悬浮窄导航 + 内容/页脚骨架（/graph 沉浸模式）
    │   ├── AiOverlay.tsx      # AI 预览/确认浮层
    │   ├── DashboardPanel.tsx # 概览面板
    │   ├── graph/
    │   │   ├── KnowledgeUniverse.tsx # 图谱容器（业务数据 + 三层视图状态 + 页面浮层）
    │   │   ├── GraphCanvas.tsx       # 画布渲染/交互（尺寸测量、force-graph 回调）
    │   │   ├── GraphBackground.tsx   # 背景环境层（透明画布下的静态纹理）
    │   │   ├── GraphDetailPanel.tsx  # 右侧知识详情面板（五操作，移动端底部 Drawer）
    │   │   ├── GraphNavigation.tsx   # 悬浮窄导航（桌面左侧 / 移动底部条）
    │   │   ├── GraphTopBar.tsx       # 顶部浮层（标识 / 搜索位 / 统计）
    │   │   ├── GraphSearch.tsx       # 搜索浮层（Ctrl/Cmd+K、结果列表、空态）
    │   │   ├── GraphContextMenu.tsx  # 节点右键/长按菜单（U4-5，clamp + 键盘）
    │   │   ├── GraphThemePanel.tsx   # 主题面板（4 冷色环境 × 4 节点风格 + 强度滑块）
    │   │   └── GraphLegend.tsx       # 记忆度浮层图例（可折叠）
    │   ├── InlineFeedback.tsx # 统一行内反馈（错误 role=alert，其余 aria-live）
    │   ├── ErrorState.tsx     # 页面级错误态（原因 + 重试 + 安全去向）
    │   ├── SegmentEditCard.tsx# 段编辑卡（含 AI 拆解/聚合入口）
    │   ├── SectionEditor.tsx  # 选区/锚点编辑
    │   ├── MemoryBadge.tsx    # 记忆档位徽标
    │   └── Skeleton.tsx       # 加载骨架
    └── app/
        ├── layout.tsx / page.tsx          # 概览
        ├── login/page.tsx                 # 登录
        ├── import/page.tsx                # 导入（文件/粘贴/语义拆分开关）
        ├── notes/page.tsx                 # 文档列表
        ├── notes/[id]/page.tsx            # 文档详情（连续阅读）
        ├── segments/[id]/page.tsx         # 知识点详情（阅读/标注/AI）
        ├── graph/page.tsx                 # 关系图谱薄壳（渲染 KnowledgeUniverse，含 ?fixture= 压测模式）
        ├── graph/mount-utils.ts           # warmup 策略与收敛阈值
        ├── graph/node-sprites.ts          # 节点离屏 sprite 缓存
        ├── graph/color-utils.ts           # 颜色缓存
        ├── ask/page.tsx                   # 助手对话
        ├── settings/page.tsx              # 设置（LLM key/model、学习者声明）
        └── api/                           # 见 §6
```

---

## 4. 数据模型（`src/db/schema.ts`，9 张表）

> 所有表主键为 `uuid defaultRandom()`；时间戳统一 `timestamptz`。

### 4.1 documents — 导入的文档

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | 文档标题 |
| `source` | text | `paste` \| `file` |
| `filename` | text? | 上传文件名 |
| `storageKey` | text? | R2 对象键；未配置 R2 时为空 |
| `tags` | text[] | frontmatter + 正文行内标签汇总 |
| `segmentCount` | int | 段数（随段增删重建） |
| `createdAt` | timestamptz | |

### 4.2 segments — 知识点（最小学习单元）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `documentId` | uuid FK → documents（级联删除） | |
| `title` / `content` | text | 标题与正文（正文不含标题行） |
| `headingPath` | text | 如 `基础篇 > 索引原理` |
| `orderIndex` | int | 文档内顺序 |
| `tags` | text[] | 段级标签（frontmatter 标签并入每段） |
| `viewCount` | int | 打开次数（含 <5s 的快速划过） |
| `firstViewedAt` / `lastViewedAt` | timestamptz? | |
| `stability` | real | 记忆稳定度（天），0=从未有效阅读 |
| `readingMs` | bigint(number) | 累计有效阅读毫秒 |
| `summary` | text? | LLM 摘要（首次查看灯点时生成并缓存） |

索引：`segments_document_idx(document_id)`。
**不变量**：记忆度 `M(t)=exp(-Δt/S)` **不落库**，读取时现算。

### 4.3 links — 关联边

| 字段 | 类型 | 说明 |
|---|---|---|
| `fromId` / `toId` | uuid FK → segments（级联） | 有向存储，展示按无向处理 |
| `kind` | text | `wiki`（`[[双链]]`）/ `tag`（共同标签）/ `doc`（同文档相邻） |
| `weight` | real | tag 边 = 共同标签数/3，封顶 1；其余默认 1 |

唯一约束 `links_unique(from_id,to_id,kind)`。

### 4.4 annotations — 划线与笔记

| 字段 | 说明 |
|---|---|
| `segmentId` | FK → segments（级联） |
| `kind` | `highlight`（仅划线）\| `note`（笔记；`quote` 为空表示节级笔记） |
| `quote` | 锚定引文（渲染文本） |
| `occurrence` | 段内第几次出现（默认 1） |
| `prefix` / `suffix` | 前后文快照，用于模糊重定位 |
| `note` | 笔记正文 |
| `color` | 默认 `amber` |
| `createdAt` / `updatedAt` | |

重定位策略：**精确 → 前后文模糊 → 失效**三级（`annotations.ts`）。段内容被 AI 改写后由 `annotation-migrate.ts` 迁移。

### 4.5 reading_events — 有效阅读流水

`segmentId`、`startedAt`、`durationMs`。仅在单次停留 ≥5 秒时写入；索引 `(segment_id)`、`(started_at)`。

### 4.5a recall_reviews — 主动回忆流水

`submissionId`（唯一幂等键）、`segmentId`（级联删除）、`question`、`referenceAnswer`、`answer`、`result`（`incorrect` / `partial` / `correct`）、`sourceVersion`、`reviewedAt`、`nextReviewAt`。

复习结果与阅读记忆度相互独立；初始调度为没答出 1 天、部分掌握 3 天、答对 7 天。

### 4.6 app_settings — 应用级 KV

`key` text PK、`value` jsonb、`updatedAt`。

| key | 值结构 | 用途 |
|---|---|---|
| `llm` | `{apiKey, model, fastModel?}` | LLM 配置，**DB 优先于 env** |
| `learner` | `{declaration}` | 学习者自述声明，注入 AI prompt |

### 4.7 llm_cache — LLM 输出缓存

`hash`（sha256(`kind|model|指纹`)）PK、`kind`（`split`/`aggregate`/`ask`）、`output` jsonb、`model`、`expiresAt`?、`createdAt`。上限 256 条，超限删最旧；`expiresAt` 到期视为未命中，**写入用 `onConflictDoUpdate` 覆盖**。

### 4.8 llm_calls — 调用流水（可观测）

`kind`（`ask`/`ask-agent`/`split`/`aggregate`/`import-split`/`summary`/`test`）、`model`、`inTok`、`outTok`、`ms`、`cached`（0/1）、`error`、`createdAt`。
索引 `(created_at)`、`(kind)`。**不记录 prompt 与画像文本。**

---

## 5. 核心功能模块与业务逻辑

### 5.1 导入与结构化拆解

**入口**：`/import` → `POST /api/notes`。

1. 接收 `.md` 文件（≤4.5MB）或粘贴文本；解析 frontmatter（`js-yaml`），提取标签与 `[[双链]]`。
2. **默认启发式拆分**（`splitter.ts`）：以 `##` 开节，`###`/`####` 折入父节；软上限 `maxChars=1800`、`minChars=300`；超长按句子边界降级；**代码块与表格为原子块，绝不在内部切分**。
3. **可选语义拆分**（导入页开关）：对超长/结构模糊的文档走 LLM 按语义切分并起标题，**每篇至多处理 5 段**；失败自动回退启发式结果。
4. 同一 batch 内写入：documents → segments → 三类 links → `segmentCount`；原文（若配置 R2）备份到 `knowledge-base-originals` 类桶。

**关键约束**：拆分不得在句中截断；LLM 输出不直接入库，导入态语义拆分是唯一例外（用户已在导入页显式启用，仍走同批写入前的服务端校验）。

### 5.2 阅读与记忆曲线（`memory.ts`）

模型：`M(t) = exp(-Δt / S)`，`Δt`=距最近有效阅读天数，`S`=稳定度（天）。

参数集中表 `MEMORY`：

| 参数 | 值 | 含义 |
|---|---|---|
| `FIRST_READ_BASE` | 0.3 天 | 首次阅读基础稳定度 |
| `FIRST_READ_GAIN` | 0.5 | 首次阅读加成（×时长权重 w） |
| `INTERVAL_EFFECT_CAP` | 1.6 | 间隔效应封顶倍数 |
| `STABILITY_CAP_DAYS` | 365 | 稳定度上限 |
| `FULL_WEIGHT_MINUTES` | 3 | 时长权重满分（w=1） |
| `MIN_WEIGHT` / `MAX_WEIGHT` | 0.2 / 1 | 权重区间 |
| `MAX_SESSION_MS` | 10 分钟 | 单次计时封顶（防挂机） |
| `MIN_EVENT_MS` | 5 秒 | 有效阅读门槛 |

上报：`POST /api/segments/[id]/view`

- 打开 ping（无 body）：`viewCount+1`、补 `firstViewedAt`；
- 停留上报（页面隐藏/卸载，`sendBeacon`）：≥5s 才写 `reading_events`、推进 `stability`、累计 `readingMs`、刷新 `lastViewedAt`；<5s 不推进。

展示：档位映射为 `M=0 → unread(未读)`、`0<M<0.4 → weak(微光)`、`0.4≤M<0.75 → medium(明亮)`、`M≥0.75 → strong(长明)`；半衰期 = `S × ln2` 天。
配色：未读 `#55504a`；已读在琥珀色系 `hsl(38, 45~70%, 32~68%)`，亮度随 M 上升。

### 5.3 关系图谱（`/graph`）

- 数据：`GET /api/graph` 返回 `{nodes, links}`，节点含 `memory`、`stability`、`viewCount`、`readingMs`、`degree` 等；全量返回（未分页/未聚合）。
- 交互：节点亮度=记忆度、大小=关联数；点击进知识点；按记忆档位与关联类型（wiki/tag/doc）过滤；拖拽重热。
- 渲染优化已做：节点属性预计算、`warmupTicks` 按规模自适应（`mount-utils.ts`）、节点 sprite 离屏缓存、API 字段瘦身、视口剔除、坐标复用、规模自适应 theta、tooltip 缓存与 deferred 过滤。
- 压测模式：`/graph?fixture=graph-small|graph-mid|graph-large`，读取 `public/fixtures/`（该目录被 gitignore，需用脚本生成）。
- 未做：社区聚合（个人真实库未达阈值）、WebGL / WASM 布局引擎（待依赖决策）。

### 5.4 标注（划线 + 笔记）

- 划线存在 `annotations`，锚定渲染文本 `quote` + `occurrence` + `prefix/suffix`。
- 段内容编辑/AI 改写后，三级重定位；无法定位则失效（不误标）。
- 节级笔记（`kind=note` 且 `quote` 为空）挂在段上，不做文本锚定。

### 5.5 AI 能力（两类，共用调用层）

**A. 编辑态拆解/聚合（preview → apply）**

| 端点 | 作用 |
|---|---|
| `POST /api/ai/split-preview` | 对某段内容提议拆分方案 |
| `POST /api/ai/split-apply` | 用户确认后落库（batch：段 + 标注迁移 + 关系重建 + 计数） |
| `POST /api/ai/aggregate-preview` | 提议多段合并方案 |
| `POST /api/ai/aggregate-apply` | 确认后落库 |
| `POST /api/ai/test` | 连通性测试（fast 档） |
| `GET /api/ai/config` | 返回是否已配置、模型名（不含 key） |
| `GET /api/ai/usage` | 用量统计（token/调用数/缓存命中） |

**B. 知识库助手 Agent（`/ask` → `POST /api/ai/ask`，SSE 流式）**

- 常驻 system 上下文：知识库概览块（`kb-overview` ≤600 字）+ 学习者画像块（≤400 字）+ 学习者声明。
- 工具集（OpenAI tools，服务端执行）：`search_knowledge`（top_k≤8）、`read_segment`、`propose_actions`（只提议不执行）。
- 循环：最多 3 轮工具调用；超出则直答收尾；每轮写 `llm_calls(kind='ask-agent')`。
- 多轮：客户端带 `history`（≤10 条），服务端无状态。
- 改动落地：`propose_actions` 生成确认卡，用户逐项确认后走 apply 端点；**LLM 永不直接写库**。
- 降级：模型不支持 `tools` 返回 400 时，自动降级为无工具直答（`mode:'agent-notools'`）。
- 缓存：仅覆盖「无工具、无改动提议」的直接回答，24h TTL。
- 已知风险：`deepseek-v4-flash` 的 function calling 未在真实 key 下实测；上游若拒绝 `tools` 会走降级路径。

**C. 调用层纪律（`llm.ts`）**

| 项 | 规则 |
|---|---|
| Provider | DeepSeek 官方 `https://api.deepseek.com`（OpenAI 兼容），**raw fetch，无 SDK** |
| 默认模型 | `deepseek-v4-flash`（常量 `DEFAULT_MODEL`，换模型只改一处） |
| 配置优先级 | `app_settings.llm` → `LLM_API_KEY`+`LLM_MODEL` → `DEEPSEEK_API_KEY`(+`DEEPSEEK_MODEL`) |
| 预算 | `max_tokens` 默认 2048（拆解类建议 4096），超限抛可读错误 |
| 重试 | 429/5xx/网络错误指数退避重试 1 次（基 1500ms），其余 4xx 不重试 |
| 并发护栏 | 进程内信号量 `MAX_CONCURRENT=3`，超出排队 |
| 超时 | 首字节 60s；流式 chunk 静默 30s，收到数据后重置 |
| 额度 | 日 token 护栏 `assertDailyTokenBudget`（`llm-calls.ts`） |
| 分档 | `fast`（摘要/测试）与 `default`；fast 未配置时等于 default |
| 可观测 | 每次调用/命中写 `llm_calls`；**不记 prompt** |

### 5.6 学习者画像与概览

- **画像**（`learner-profile.ts`）：五项 SQL 下推聚合——档位分布、薄弱知识点 top5、7 日阅读事件/累计时长、最近 5 条实质标注、枢纽 top3。带缓存；供 ask 与拆解/聚合 prompt 注入；**只读不写业务数据**。
- **概览**（`/`）：`GET /api/stats`，进程内缓存 60s，`X-Cache` 头标识命中；返回总数、档位分布、今日阅读数、最近导入、`suggestion`（薄弱×中心性 top1）、`weakTop3`、`unreadTop3`。纯规则，不调 LLM。
- **概览块**（`kb-overview.ts`）：≤600 字，任一查询失败该项写「—」不阻断对话。

### 5.7 鉴权与安全

| 项 | 实现 |
|---|---|
| 会话令牌 | `sha256("kb-v1:" + AUTH_PASSCODE)`，不落库、不加盐（个人自用，泄露面=口令本身） |
| Cookie | `kb_session`，30 天，HttpOnly |
| 校验 | 常量时间比较；`proxy.ts` 与各路由 `guard()` 双层 |
| fail-closed | 未配置口令 → 页面跳登录、API 503 |
| 登录限流 | `login-rate-limit.ts`（失败次数限制） |
| 开放重定向 | `safeNextPath()` 只允许站内绝对路径 |
| 安全头 | `X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`、强制 CSP |
| 注入防护 | tooltip 等拼接 HTML 处统一 `escapeHtml()` |
| Key 保护 | AES-GCM 加密存储（`SETTINGS_ENCRYPTION_KEY` 或口令派生）；只回尾 4 位；不写日志 |

### 5.8 R2 原文备份

`r2.ts` 用 S3 SDK 写 `{bucket}`；未配置 `R2_*` 时导入正常，仅不备份。当前仅存原文，不存附件图片。

---

## 6. API 端点清单（Route Handlers）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/notes` | 文档列表（含段数、标签） |
| POST | `/api/notes` | 导入：拆分 + 建关系 + 备份原文 |
| GET | `/api/notes/[id]` | 文档详情 |
| PATCH | `/api/notes/[id]` | 改文档标题/标签 |
| DELETE | `/api/notes/[id]` | 删文档（级联段与边；含 R2 清理） |
| POST | `/api/notes/[id]/segments` | 追加知识点（指定 afterIndex） |
| GET | `/api/notes/[id]/annotations` | 文档下全部标注 |
| GET | `/api/segments/[id]` | 知识点详情（含记忆度现算、上下段导航） |
| PATCH | `/api/segments/[id]` | 改标题/内容/标签（内容变更迁移标注 + 重建关系） |
| DELETE | `/api/segments/[id]` | 删知识点（重建顺序链与计数） |
| POST | `/api/segments/[id]/move` | 移动顺序 |
| POST | `/api/segments/[id]/view` | 阅读上报（打开 ping / 停留上报） |
| GET | `/api/learning/today` | 今日学习推荐 + 近 7 天反馈 |
| POST | `/api/learning/question` | 基于当前知识段生成主动回忆题 |
| POST | `/api/learning/reviews` | 保存复习结果，幂等且校验内容版本 |
| GET | `/api/learning/weekly` | 14 天学习热力与 7 天对比报告 |
| GET | `/api/segments/[id]/summary` | 取/生成 30 字摘要（LLM，fast 档，缓存） |
| GET | `/api/segments/[id]/annotations` | 该段标注 |
| POST | `/api/segments/[id]/annotations` | 新建划线/笔记 |
| DELETE | `/api/annotations/[id]` | 删除标注 |
| GET | `/api/graph` | 图数据（nodes/links，全量） |
| GET | `/api/stats` | 概览统计（60s 进程内缓存） |
| POST | `/api/auth/login` | 口令登录，下发 Cookie |
| POST | `/api/auth/logout` | 退出 |
| GET / POST | `/api/settings` | 读配置（key 尾号）/ 存 LLM 配置 |
| GET | `/api/learner-profile` | 画像 |
| POST | `/api/ai/ask` | 助手 Agent（SSE 流式） |
| POST | `/api/ai/explain` | 解释阅读选区 |
| POST | `/api/ai/connect` | 对比两个概念及共同邻居 |
| POST | `/api/ai/split-preview` / `split-apply` | 编辑态拆解 预览/落地 |
| POST | `/api/ai/aggregate-preview` / `aggregate-apply` | 编辑态聚合 预览/落地 |
| POST | `/api/ai/test` | 连通性测试 |
| GET | `/api/ai/config` | 配置状态（不含 key） |
| GET | `/api/ai/usage` | 用量与缓存命中 |

**统一约定**：所有非 auth 端点首行 `await guard(req)`；错误响应 `{ error: string }` + 400/401/404/503；id 均为 uuid 并用 `isUuid()` 校验。

---

## 7. 页面与路由

| 路径 | 内容 |
|---|---|
| `/login` | 单口令登录（`?next=` 回跳） |
| `/` | 概览：档位分布、今日阅读、最近导入、今日先看 |
| `/import` | 上传/粘贴导入、语义拆分开关、结果预览 |
| `/notes` | 文档列表 |
| `/notes/[id]` | 文档详情：连续阅读、上下段导航、标注总览 |
| `/segments/[id]` | 知识点详情：正文、记忆状态卡、划线/笔记、AI 拆解/聚合 |
| `/graph` | 关系图谱（支持 `?fixture=`） |
| `/ask` | 助手对话（流式、来源引用、改动确认卡） |
| `/study/[segmentId]` | 主动回忆：先作答、再揭晓答案、记录结果、回看来源 |
| `/progress` | 学习复盘：14 天热力、周期对比、优先项 |
| `/settings` | LLM Key/模型、学习者声明、用量查看 |

---

## 8. 关键依赖与第三方服务

| 服务 | 用途 | 免费额度/成本 | 未配置时行为 |
|---|---|---|---|
| Neon Serverless Postgres | 主数据库 | 免费层 100 项目 × 1GB | 启动报错（必填） |
| Cloudflare R2 | 原文 md 备份 | 免费 10GB、出网免费 | 导入正常，不备份 |
| DeepSeek API | 拆解/聚合/摘要/问答/助手 | 按 token 计费（个人可控） | AI 功能禁用并给出配置指引 |
| Vercel Hobby | 托管 | 个人非商业免费 | — |
| Playwright Chromium | E2E | 本地需 `npx playwright install chromium` | E2E 跳过/CI 自动安装 |

**依赖策略**：优先零新增依赖；`llm.ts` 用 raw fetch 而非 SDK 即为贯彻此策略。新增依赖需在方案文档中说明理由。

---

## 9. 本地开发与运行

### 9.1 首次启动

```bash
cp .env.example .env.local        # 填 DATABASE_URL、AUTH_PASSCODE（R2/LLM 可选）
npm install
npm run db:migrate                # 顺序执行 src/db/migrations/，记录到 _kb_migrations
npm run dev                       # http://localhost:3000
```

### 9.2 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Neon **Pooled** 连接串（`?sslmode=require`） |
| `AUTH_PASSCODE` | 是 | 登录口令，足够长的随机串 |
| `SETTINGS_ENCRYPTION_KEY` | 否 | LLM Key 加密主密钥；未配置时从 AUTH_PASSCODE 派生 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 否 | 原文备份 |
| `LLM_API_KEY` / `LLM_MODEL` | 否 | 回退配置（推荐在设置页填，即存即用） |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 否 | 用户惯例命名的回退；只给 key 时模型默认 `deepseek-v4-flash` |

### 9.3 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发（Turbopack） |
| `npm run build` / `start` | 生产构建 / 启动 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` / `test:watch` | Vitest 单测 |
| `npm run test:e2e` | 起服务 + Playwright（`scripts/run-e2e.mjs`） |
| `npm run db:generate` | 由 schema 生成迁移 SQL 到 `src/db/migrations/` |
| `npm run db:migrate` | 执行迁移（Neon HTTP） |
| `npm run db:migrate:check` | 只读检查（`--dry-run`） |
| `npm run db:push` / `db:studio` | 直推 schema / 数据浏览 |

### 9.4 迁移机制

- 目录 `src/db/migrations/`，当前 8 个版本：`0000_init` → `0007_wooden_wong`。
- `apply-migrations.mjs` 按 SQL 文件名执行并记录校验和到 `_kb_migrations`；完整旧库自动建立基线；重复执行不重放。
- 升级前可 `db:migrate:check` 只读预演。

### 9.5 测试与 CI

- 单测：`src/lib/__tests__/`（memory、splitter、links、rag、llm、llm-cache、annotations、security、proxy、stats-route、view-route、dashboard-panel、segment-edit-card 等）。
- E2E：`e2e/auth-graph.spec.ts`（登录门、图谱、主动回忆、AI 解释、学习复盘），固定网络响应避免依赖真实 key。
- CI（`.github/workflows/ci.yml`）：test → lint → typecheck → build → 安装 Chromium → E2E。

---

## 10. 已实现的核心特性清单

**知识建模**

- Markdown 导入（文件/粘贴），frontmatter + 行内标签 + `[[双链]]` 提取
- 标题层级结构化拆解，句边界降级，代码/表格原子保真
- 三类自动关联（双链 / 共同标签 / 同文档相邻），权重计算
- 文档与知识点的增删改、顺序移动、追加插入、级联删除

**学习闭环**

- 阅读时长采集（可见计时、隐藏上报、≥5s 有效、3 分钟全效、10 分钟封顶）
- 记忆曲线模型（替代 SM-2）：稳定度推进 + 指数衰减 + 半衰期
- 记忆档位与灯光配色，详情页状态卡
- 划线与笔记（三级重定位），段内容变更自动迁移
- 今日学习：错题优先 / 到期复习 / 最近读过未测 / 新知识，3 条可解释推荐
- 主动回忆：先作答，再揭晓参考答案，记录没答出 / 部分掌握 / 答对
- 复习调度与近 7 天反馈：自测数、需巩固数、改善数、活跃天数
- 概览面板：今日学习、档位分布、今日阅读、最近导入、薄弱推荐、未读推荐
- 学习复盘：近 7 天自测/巩固/改善/活跃天数、14 天热力、下一步优先项

**可视化**

- 力导向图谱，亮度=记忆度、大小=度数，按档位/关联类型过滤
- 图谱性能基线优化（预计算、warmup、sprite、字段瘦身、拖拽重热）
- 图谱视口剔除、坐标复用、规模自适应 theta、tooltip 缓存与 deferred 过滤
- 压测模式与数据生成器

**AI**

- 编辑态 AI 拆解/聚合：preview → 确认 → apply（含标注迁移 + 关系重建，同事务）
- 导入态 LLM 语义拆分（按需开关，每篇 ≤5 段，失败回退启发式）
- 知识点 30 字摘要（fast 档 + DB 缓存）
- 知识库助手 Agent：自主检索/读取/提议改动，SSE 流式，确认卡落地，≤3 轮工具循环
- 学习者画像（5 项聚合）+ 知识库概览块注入 prompt + 自述声明
- 调用可观测（llm_calls）、输出缓存（256 条）、max_tokens 预算、重试、并发护栏、日 token 护栏、模型分档

**工程与安全**

- 单口令全站登录门（Proxy + 路由双层 guard）、登录限流、安全跳转
- 安全响应头（强制 CSP + `frame-ancestors 'none'`）、HTML 转义
- Neon HTTP batch 原子写、迁移版本表与只读预演
- Vitest 单测 + Playwright E2E + CI
- 进程内 TTL 缓存与写后失效

---

## 11. 待开发功能（详见 `docs/未完成任务清单.md`）

按主题归纳，**不在此重复细节**：

| 主题 | 代表项 |
|---|---|
| AI 深度能力 | 自测三问（待产品边界）、pgvector 检索（条件触发） |
| 图谱规模化 | 社区聚合（个人真实数据未达阈值）、WebGL/WASM（待依赖决策） |
| 产品 Roadmap | 正式测验、PDF/DOCX/网页剪藏、附件图片 |
| 技术债/安全 | 内联样式收紧（CSP Report-Only 审计后再收紧 `style-src`） |
| 体验与视觉 | 助手对话上下文、首页层级收敛、小字对比度、窄屏弹层与热力图（见 `docs/visual-iteration-plan.md`） |

> **状态更正（2026-10-29 终次复核）**：任务清单 v1.2 已完成 21/29 项；“解释这段、联系两概念、学习周报、三档压测、图谱优化、Key 加密、CSP、流式静默超时”均已落地；剩余 8 项已记录阻塞条件。

---

## 12. 约束条件与技术规范（必读）

### 12.1 硬性约束（不得违反）

1. **零新增依赖优先**：新能力先评估能否用 Web 标准/原生 API/现有依赖实现；确需新增须在方案文档说明并获确认。
2. **LLM 输出永不直接写库**：一律 preview → 用户确认 → apply 两步；唯一受控例外是导入页显式启用的语义拆分（服务端仍做形状校验）。
3. **隐私铁律**：`llm_calls` 只记 kind/model/token/耗时/缓存/错误摘要，**绝不记录 prompt 与画像文本**；API key 只存服务端，只回尾 4 位。
4. **记忆度不落库**：只存 `stability` / `readingMs` / 事件流水，`M(t)` 读取时现算；SQL 聚合表达式必须与 `memory.ts` 保持一致（`exp(-Δt/86400/greatest(S,1e-9))`，档位阈值 0.4 / 0.75）。
5. **单用户设计**：不做多租户、注册、角色；任何权限相关改动默认「单口令全覆盖」。
6. **数据库写入走 batch**：多表变更（段 + 标注迁移 + 关系重建 + 计数）必须同一 batch 原子提交。
7. **拆分不得破坏结构**：代码块与表格为原子块；不在句中截断；`minChars` 合并防碎片化。
8. **Next.js 16 特殊**：改代码前先读 `node_modules/next/dist/docs/`；`AGENTS.md` 中的 nextjs-agent-rules 块由 `next dev` 自动重写，勿在 diff 中删除。

### 12.2 编码约定

| 约定 | 说明 |
|---|---|
| 语言 | 注释、错误提示、文档一律简体中文；标识符英文 |
| 路径别名 | `@/` → `src/` |
| API 校验 | 入口 `guard()` → 参数类型/长度/uuid 校验 → 业务 → 统一错误体 `{error}` |
| 错误处理 | 用户可见错误用中文短句，不用堆栈；LLM 不可用时给出可执行指引（去设置页） |
| 缓存 | 高频只读走 `cache.ts`（进程内 TTL + 写后 `invalidateCache`）；LLM 输出走 `llm_cache` |
| 时间 | DB 层 `timestamptz`；接口返回 ISO/Date；记忆度计算统一用 `Date.now()` 差值 |
| 组件 | 交互态用客户端组件；数据获取在 RSC/路由；骨架屏用 `Skeleton.tsx` |
| 测试 | 纯函数逻辑（memory/splitter/links/quotes）必须有 Vitest 用例；路由关键校验有测试 |

### 12.3 已知坑点（避免重复踩）

| 坑 | 说明/规避 |
|---|---|
| **Neon HTTP 瞬时故障** | 实测会出现 `Error connecting to database: TypeError: fetch failed`（cause: AggregateError / ETIMEDOUT），同一端点重试即 200。已做三层处置：只读查询 `withDbRetry` 指数退避重试 → 仍失败回退「上一次成功结果」的陈旧快照（响应头 `X-Cache: STALE`）→ 无快照时返回 503 + 中文提示，前端展示可重试错误态。**写路径不走重试**（避免重复写） |
| **陈旧快照的取舍** | `cache.ts` 的新鲜缓存 TTL 60s，陈旧快照保留 15 分钟；写路径失效时两者一起清掉。学习类端点（今日学习/学习复盘）刻意不做新鲜缓存（TTL=0），避免推荐结果过期 |
| `next build` 缺 `DATABASE_URL` | `db` 为 Proxy 惰性初始化，勿在模块顶层直接查询 |
| 进程内缓存多实例不一致 | Vercel 多实例下写后失效只影响当前实例；接受 best-effort |
| `public/fixtures/*.json` 被 gitignore | 压测数据需 `gen-graph-data.mjs` 重新生成 |
| CSP 与内联 style | 当前 CSP 允许内联 style；若继续收紧，先运行 Report-Only 审计 |
| API key 加密主密钥 | 未配置 `SETTINGS_ENCRYPTION_KEY` 时从 AUTH_PASSCODE 派生；改口令会使旧密文不可解 |
| `deepseek-v4-flash` function calling 未实测 | 上游 400 时走 `agent-notools` 降级；新增工具需考虑降级路径 |
| 图谱全量返回 | 大库会慢；>8k 需视口裁剪/聚合，但先取压测数据再立项 |
| 4.5MB 请求体 | 超大 md 分次粘贴；不要假设可一次导入任意大小文件 |
| 记忆度口径分叉 | 任何新查询若算 M，必须复制同一表达式与阈值，否则档位统计会不一致 |

### 12.4 文档体系与协作规范

| 文档 | 角色 |
|---|---|
| `README.md` | 面向使用者的安装/使用/Roadmap/已知限制 |
| `docs/spec.md` | 产品设计与数据契约（含 Roadmap 编号 #1–#7） |
| `docs/llm-optimization-plan.md` | LLM 成本/质量的措施表（L1/L2/L3）与验收指标 |
| `docs/graph-performance-plan.md` | 图谱分层优化方案（R/C/D/I 系列）与压测标准 |
| `docs/ux-optimization-plan.md` | 体验优化（已完成，含交付记录） |
| `docs/排查.md` | 代码审计问题台账（P1/P2/P3 优先级来源） |
| `docs/未完成任务清单.md` | 未完成事项的单一事实来源（需随完成情况更新） |
| 本文档 | 给对话 AI 的项目上下文快照 |

**任务状态流转约定**：完成一项 → 从任务清单移除 + 在源方案文档补交付记录（日期 + 验证方式）。`docs/排查.md` 的 P1/P2/P3 是历史优先级口径，不要与任务清单优先级混用。

---

## 13. 对话 AI 速查（常见问题标准答案）

| 问题 | 标准回答要点 |
|---|---|
| 记忆度怎么算？为什么不是 SM-2？ | `M=exp(-Δt/S)`；SM-2 依赖主观评分，本项目用阅读行为客观推进稳定度，无需用户自评 |
| 为什么记忆度不存库？ | 它会随时间连续衰减，落库即过期；只存稳定度与阅读流水，读取时现算 |
| 为什么 AI 不能直接改库？ | 铁律：LLM 不可信，一律 preview → 确认 → apply；避免误改/误删 |
| 图谱为什么暗？ | 亮度就是记忆度，暗灰=未读；这是设计意图，不是 bug |
| 导入为什么只支持 md？ | 当前设计取舍；PDF/DOCX/图片在 Roadmap，受 4.5MB 与零依赖约束 |
| 为什么没有 CSP？ | 已配置强制 CSP（含 `frame-ancestors 'none'`）；`style-src` 暂保留 `'unsafe-inline'` 以兼容图谱 tooltip 与 React 内联样式，收紧前先跑 Report-Only 审计 |
| 为什么缓存有时不生效？ | 进程内缓存 per-instance；LLM 缓存有 256 条上限与 TTL |
| 能多人用吗？ | 不能。单口令、无用户表、无权限模型 |
| 支持中文/英文？ | 拆解按标题层级与句子边界，中英均适用；界面为中文 |
| 大库卡怎么办？ | 先跑 `/graph?fixture=graph-large` 取基线，再决定视口裁剪/聚合/WebGL，不要直接上重方案 |

---

## 14. 维护说明

- 本文档随重大架构变更（表结构、调用层纪律、铁律、端点增删）同步更新，并在文首更新基线 commit。
- 本文不承担「任务进度」职责，进度一律以 `docs/未完成任务清单.md` 为准。
- 事实来源优先级：**代码 > 迁移 SQL > 本文档 > 其他 docs**。
