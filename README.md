# 个人知识库

跨设备访问、自动关联、打开即学习的个人知识库。为解决 Obsidian 本地笔记的痛点而生：知识不再锁在本地、不用手动归类关联、关系图谱按**记忆程度**着色，一眼看出哪些内容快忘了。

## 核心特性


| Obsidian 痛点                  | 本项目的解法                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| 知识在本地，跨设备要付费同步   | 部署在 Vercel，任何设备浏览器访问                                                        |
| 不知道如何归类、关联要手动建   | 导入时自动提取标签和`[[双链]]`，自动建立三类关联（双链/共同标签/同文档）                 |
| 关系图谱庞大，看不出哪些快忘了 | 力导向图节点按记忆度呈紫色系亮度渐变（灰=未读，越亮记得越牢），可按记忆档位/关联类型过滤 |
| 记忆保持缺少反馈               | 阅读即学习：详情页自动采集停留时长，按记忆曲线模型推进稳定度，展示记忆度与半衰期         |
| 长文阅读容易失去耐心           | 导入时按标题层级结构化拆解为合适长度的知识点，绝不在句中截断                             |

## 技术栈

- **前端**：Next.js 16（App Router、Turbopack、Cache Components）+ Tailwind CSS 4 + react-force-graph-2d
- **数据库**：[Neon](https://neon.tech) Serverless Postgres（免费层 100 项目 × 1GB）+ Drizzle ORM
- **对象存储**：[Cloudflare R2](https://developers.cloudflare.com/r2/)（免费 10GB、流量免费）备份导入的原始 md
- **部署**：[Vercel Hobby](https://vercel.com)（个人非商业免费）
- **认证**：单口令登录（`AUTH_PASSCODE` 环境变量 + HttpOnly Cookie + Proxy 网关），个人自用无注册体系

## 快速开始

### 1. 准备 Neon 数据库

1. 注册 [neon.tech](https://neon.tech)，创建项目
2. 复制连接串（选 **Pooled connection**，形如 `postgresql://user:pass@ep-xxx-pooler.xx.aws.neon.tech/neondb?sslmode=require`）

### 2. 准备 Cloudflare R2（可选，不配则不备份原文）

1. R2 控制台创建存储桶（如 `knowledge-base-originals`）
2. Manage API Tokens → 创建 `Object Storage: Edit` 权限的 Token，得到 Access Key ID / Secret

### 3. 本地运行

```bash
cp .env.example .env.local   # 填入 DATABASE_URL、AUTH_PASSCODE，可选填 R2_*
npm install
npm run db:migrate           # 顺序执行迁移建表（Neon HTTP 驱动）
npm run dev                  # http://localhost:3000
```

### 4. 部署到 Vercel

```bash
git init && git add -A && git commit -m "init"   # 若尚未初始化 git
git remote add origin <你的 GitHub 仓库> && git push -u origin main
```

然后到 [vercel.com](https://vercel.com) → Add New Project → 导入该仓库，在 **Environment Variables** 里配置：


| 变量                                                                        | 说明                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                              | Neon Pooled 连接串                                                                                       |
| `AUTH_PASSCODE`                                                             | 登录口令（足够长的随机串）                                                                               |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 可选，R2 备份                                                                                            |
| `LLM_API_KEY` / `LLM_MODEL`                                                 | 可选回退——推荐在应用内「设置」页配置 DeepSeek API Key（存服务端 DB，即存即用），启用 AI 拆解/聚合/问答 |

部署完成后先执行一次建表：`DATABASE_URL=<连接串> npm run db:migrate`。

## 使用流程

1. **导入**（`/import`）：上传 `.md` 文件或粘贴内容 → 按 `##`/`###`/`####` 标题层级自动拆解知识点，超长内容按句子边界降级，代码块与表格保持完整
2. **阅读**（知识点详情）：停留时长自动采集（可见时计时、切走/关闭时上报）——单次 ≥5 秒记一次有效阅读并推进记忆稳定度，3 分钟全效、单次封顶 10 分钟；状态卡展示记忆度、半衰期（预计多少天后忘一半）、阅读次数与累计时长
3. **关系图谱**（`/graph`）：节点颜色 = 记忆度（灰=未读，紫色系亮度随记忆度上升），节点大小 = 关联数，点击进入知识点；支持按记忆档位（未读/弱/中/强）与关联类型筛选
4. **概览**（`/`）：记忆档位分布、今日阅读数、最近导入

记忆模型（详见 `src/lib/memory.ts`，参数集中在 `MEMORY` 常量表）：记忆度 M(t) = exp(-Δt/S)，Δt 为距最近一次有效阅读的天数，S 为稳定度；每次有效阅读按间隔效应推进 S（间隔越远增幅越大，封顶 1.6 倍），阅读时长决定推进权重。记忆度由 API 读取时现算，不落库。

## 压测

`scripts/gen-graph-data.mjs` 生成与 `/api/graph` 同构的社区结构图数据，`/graph?fixture=graph-small|graph-mid|graph-large` 直接加载 `public/fixtures/` 下的数据集（含 memory/stability/viewCount/readingMs 字段）。

## 常用脚本

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm run test         # 单元测试（分割器、记忆模型）
npm run db:migrate   # 顺序执行 src/db/migrations/ 下的迁移（Neon HTTP）
npm run db:generate  # 生成迁移 SQL（src/db/migrations/）
npm run db:studio    # Drizzle Studio 查看数据
```

## 目录结构

```
src/
├── proxy.ts                 # 认证网关（全站登录门）
├── db/
│   ├── schema.ts            # documents / segments / links / reading_events
│   ├── index.ts             # Neon 连接（惰性初始化）
│   └── migrations/          # 生成的 SQL 迁移
├── lib/
│   ├── splitter.ts          # Markdown → 知识点结构化拆解
│   ├── markdown.ts          # frontmatter / 标签 / [[双链]] 提取
│   ├── memory.ts            # 记忆曲线模型（稳定度推进 / 记忆度衰减 / 档位与配色）
│   ├── r2.ts                # R2 原文备份
│   └── auth.ts / api.ts / client.ts
├── components/              # AppShell / MemoryBadge
└── app/
    ├── page.tsx             # 概览
    ├── login/ import/ notes/ segments/ graph/
    └── api/                 # notes / segments / graph / stats / auth
```

## 已知限制

- Vercel Hobby 请求体上限约 4.5MB：超大 md 建议粘贴分次导入
- 单用户设计：一个 `AUTH_PASSCODE`，无多用户/注册体系
- 导入仅支持 Markdown 纯文本；图片等附件暂不处理

## Roadmap

- [X]  测验模式：由知识点自动生成选择题/填空题，替代自评
- [X]  LLM 语义拆解/聚合（编辑态）：preview → 确认 → apply 两步，RAG 上下文注入，导入默认仍用启发式拆分
- [X]  应用内设置页（DeepSeek API Key 存服务端 DB）与「问知识库」RAG 问答
- [ ]  LLM 语义分割（导入态）：导入长文时按语义切分并起标题
- [ ]  更多导入格式（PDF / DOCX / 网页剪藏）
- [ ]  附件与图片上传到 R2 并在知识点内渲染
- [ ]  学习热力图与学习统计报表
