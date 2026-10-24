# 个人知识库

跨设备访问、自动关联、打开即学习的个人知识库。为解决 Obsidian 本地笔记的痛点而生：知识不再锁在本地、不用手动归类关联、关系图谱按**掌握程度**着色，一眼看出哪些内容还没掌握。

## 核心特性

| Obsidian 痛点 | 本项目的解法 |
|---|---|
| 知识在本地，跨设备要付费同步 | 部署在 Vercel，任何设备浏览器访问 |
| 不知道如何归类、关联要手动建 | 导入时自动提取标签和 `[[双链]]`，自动建立三类关联（双链/共同标签/同文档） |
| 关系图谱庞大，看不出哪些没掌握 | 力导向图节点按掌握度从红到绿着色，未学习灰色，可按状态/关联类型过滤 |
| 掌握程度缺少反馈 | 打开即学习：每日首次打开自动按 SM-2 推进掌握度并给出建议回看时间 |
| 长文阅读容易失去耐心 | 导入时按标题层级结构化拆解为合适长度的知识点，绝不在句中截断 |

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
npm run db:push              # 把 schema 推到 Neon 建表
npm run dev                  # http://localhost:3000
```

### 4. 部署到 Vercel

```bash
git init && git add -A && git commit -m "init"   # 若尚未初始化 git
git remote add origin <你的 GitHub 仓库> && git push -u origin main
```

然后到 [vercel.com](https://vercel.com) → Add New Project → 导入该仓库，在 **Environment Variables** 里配置：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Neon Pooled 连接串 |
| `AUTH_PASSCODE` | 登录口令（足够长的随机串） |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 可选，R2 备份 |

部署完成后先执行一次建表：`DATABASE_URL=<连接串> npm run db:push`。

## 使用流程

1. **导入**（`/import`）：上传 `.md` 文件或粘贴内容 → 按 `##`/`###`/`####` 标题层级自动拆解知识点，超长内容按句子边界降级，代码块与表格保持完整
2. **学习**（知识点详情）：打开即学习——每次打开记录查看，每日首次打开自动推进 SM-2 掌握度；概览的「建议回看」到期后回看对应知识点
3. **关系图谱**（`/graph`）：节点颜色 = 掌握度（灰=未学习，红→绿=低→高），节点大小 = 关联数，点击进入知识点
4. **概览**（`/`）：建议回看数、掌握分布、最近导入

掌握度由 SM-2 状态派生：间隔 ≥ 21 天且无遗忘 ≈ 已掌握；间隔越长、ease 越高、遗忘越少，掌握度越高。详见 `src/lib/sm2.ts`。

## 常用脚本

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm run test         # 单元测试（分割器、SM-2）
npm run db:push      # 推送 schema 到数据库
npm run db:generate  # 生成迁移 SQL（src/db/migrations/）
npm run db:studio    # Drizzle Studio 查看数据
```

## 目录结构

```
src/
├── proxy.ts                 # 认证网关（全站登录门）
├── db/
│   ├── schema.ts            # documents / segments / links / review_logs
│   ├── index.ts             # Neon 连接（惰性初始化）
│   └── migrations/          # 生成的 SQL 迁移
├── lib/
│   ├── splitter.ts          # Markdown → 知识点结构化拆解
│   ├── markdown.ts          # frontmatter / 标签 / [[双链]] 提取
│   ├── sm2.ts               # SM-2 间隔重复 + 掌握度派生
│   ├── r2.ts                # R2 原文备份
│   └── auth.ts / api.ts / client.ts
├── components/              # AppShell / MasteryBadge / GradeButtons
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

- [ ] 测验模式：由知识点自动生成选择题/填空题，替代自评
- [ ] LLM 智能分割：语义级拆分长文，替代标题+段落启发式
- [ ] 更多导入格式（PDF / DOCX / 网页剪藏）
- [ ] 附件与图片上传到 R2 并在知识点内渲染
- [ ] 学习热力图与学习统计报表
