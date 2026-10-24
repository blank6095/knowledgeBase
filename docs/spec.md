# 设计文档：个人知识库

> 需求来源：用户对 Obsidian 使用痛点的整理。目标：**提升学习效率**。

## 1. 需求与痛点

| # | 痛点 / 需求 | 实现方案 | 状态 |
|---|---|---|---|
| 1 | 知识只能存本地，跨设备访问需付费 | 全部数据在 Neon Postgres，应用部署 Vercel，任意设备浏览器访问 | ✅ |
| 2 | 不知道如何归类，关联知识需手动建立 | 导入时自动提取 frontmatter/行内标签与 `[[双链]]`，自动建立三类关联边 | ✅ |
| 3 | 知识网络肉眼难以判断哪些未掌握 | 力导向图：掌握度映射红→绿色，未学习灰色；支持状态/关联类型过滤 | ✅ |
| 4 | 根据最近查看时间、查看次数、复习调查得出掌握程度 | 查看行为自动记录（次数/首末时间）+ SM-2 复习评分，共同派生 0~1 掌握度 | ✅ |
| 5 | 从外部引入知识，先支持 md | 导入页支持 .md 文件与粘贴，原文备份 R2 | ✅ |
| 6 | 长段可分割知识点理性分割，避免复习失去耐心 | 按 ## 标题切分，超长按段落贪心组块（默认 ≤1200 字符，可调） | ✅ |
| 7 | 测验式复习调查 | Roadmap：选择题/填空题生成 | ⏳ |

## 2. 关键技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 框架 | Next.js 16 App Router | Vercel 原生支持；API Routes 免独立后端，Hobby 计划可零成本部署 |
| 数据库访问 | Drizzle ORM + neon-http 驱动 | 类型安全、轻量；HTTP 驱动适配 Serverless 函数冷启动 |
| 认证 | 单口令 + Cookie + Proxy 网关 | 个人自用，无需用户体系；全站（页面+API）统一拦截 |
| 复习算法 | SM-2（Anki 式 4 档评分，天粒度） | 成熟、可解释、无需外部服务；掌握度由 interval/ease/lapses 派生 |
| 分割算法 | 标题切分 + 段落贪心组块 | 可离线、可解释、可控长度；LLM 语义分割列入 Roadmap |
| 关联构建 | wiki（双链标题匹配）/ tag（共同标签）/ doc（同文档相邻） | 三类边互补：作者意图、主题相似、结构相邻 |
| 知识网络 | react-force-graph-2d（Canvas） | 性能好、交互成熟（悬停/点击/缩放），客户端渲染 |

## 3. 数据模型

```
documents ──1:N── segments ──1:N── review_logs
                    │
                    └──M:N(自关联)── links（from/to/kind/weight）
```

- **documents**：导入的文档（标题、来源、R2 键、标签、知识点数）
- **segments**：知识点（标题、内容、headingPath、顺序、标签）
  - 观测：viewCount、firstViewedAt、lastViewedAt
  - SM-2：ease、intervalDays、reps、lapses、dueAt、lastGrade
  - 派生：mastery(0~1)、status(new/learning/familiar/mastered)
- **links**：kind ∈ {wiki, tag, doc}，unique(from, to, kind)
- **review_logs**：每次评分留痕（评分、前后间隔）

## 4. 掌握度与状态派生（src/lib/sm2.ts）

```
mastery = (0.75 × min(1, intervalDays/21) + 0.25 × easeScore) × 遗忘衰减
status: reps=0 → new；interval≥21 且无遗忘 → mastered；interval≥7 → familiar；否则 learning
```

图谱颜色：new 灰色，其余按 mastery 在色相 0（红）→ 142（绿）间插值。

## 5. 后续迭代方向

1. **测验模式**：基于知识点内容生成选择题（可接 LLM），评分回写 SM-2
2. **LLM 语义分割**：对无结构长文按语义切分并起标题
3. **更多格式**：PDF / DOCX 解析导入
4. **附件**：图片上传 R2，知识点内渲染
5. **统计**：复习热力图、遗忘曲线、薄弱主题排行
