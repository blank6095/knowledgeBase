# 体验与性能优化方案（四任务包，提示词可独立交付主线执行）

> **计划状态**：本文为专项计划/交付记录，任务状态与开放项以 [未完成任务清单](../未完成任务清单.md) 为准；文中路径相对仓库根书写。

> 勘察基线：2026-10-26（本轮核实，文件与行号均来自当轮代码）。
> 四个任务相互独立，可按推荐顺序逐个交付；每个任务的提示词自包含，直接复制给主线即可。
> 执行顺序建议：**C（闪动 bug）→ D（节点编辑删除）→ A（缓存）→ B（概览重定位）**。
> C 最小且独立；D 补齐明显功能缺口；A 触点多但机械；B 是产品决策，建议先认可方向再执行（见决策点）。

## 任务总览

| 任务 | 类型 | 一句话 | 涉及面 |
|---|---|---|---|
| C | bug | 图谱加载双闪动：先归因后修复 | graph/page.tsx 挂载序列 |
| D | 功能 | 知识点详情页补编辑/删除（v10 能力只在文档编辑模式里，节点自己的页面没有） | segments/[id] |
| A | 性能 | 统一服务端缓存：/api/graph 每次全表扫描 + 其余热点端点 | lib/cache.ts + 6 个路由 |
| B | 设计 | 概览页与图谱的"掌握度"表达冲突：从状态看板重定位为行动面板 | 概览页 + 色编码规范 |

## 决策点（执行 B 前需要用户确认）

B 的核心判断是"概览不该是第二个状态看板"。若你更想保留统计看板形态，只执行 B 中的
「色编码统一」部分、跳过「重定位为行动面板」，交付时对主线说明即可。

---

## Task C 提示词：修复关系图谱加载双闪动

```
# 角色
你是本仓库（Next.js 16 + react-force-graph-2d 深色"暗夜书房"知识库）的前端工程师。
任务：修复关系图谱页加载时出现的两次闪动。要求先归因、后修复——用证据锁定两次闪动
各自是什么，再动手。

# 项目事实（已核实，直接引用）
- src/app/graph/page.tsx:
  * :141 const [size, setSize] = useState({ w: 900, h: 560 })——默认尺寸硬编码；
  * :157 ResizeObserver 挂在 wrapRef 上，依赖 [nodes] 的 effect 里重挂——数据到达后
    才首次测量真实尺寸；
  * nodes===null 时渲染骨架容器（无 wrapRef），数据到达后同一次 commit 里 Graph 以
    默认 900×560 挂载 → 下一帧 observer 触发真实尺寸 → width/height 变化 → 画布重设
    （闪动嫌疑①：尺寸跳变重绘）；
  * d3 引擎首帧从初始坐标开始模拟，节点存在"开屏爆炸"（从中心散开的过程可见）
    （闪动嫌疑②：布局未收敛即首绘）；
  * dev 模式 StrictMode 双挂载会使引擎初始化两次（嫌疑③，仅 dev 可见，需排除）；
  * 数据加载 fetch（/api/graph 或 ?fixture=）完成后一次性 setNodes/setLinks。
- 压测：/graph?fixture=graph-small|graph-mid；深色画布常量 CANVAS.bg。
- 写码前先读 AGENTS.md。

# 任务
1. 归因：用 Performance 录制（或 CPU 6x 节流 + 慢速观察）加载过程，逐帧对照确认两次
   闪动分别对应哪个候选（尺寸跳变 / 开屏爆炸 / StrictMode 双挂载 / 其他），汇报归因结论；
2. 修复尺寸跳变：首次测量先行——容器挂 ref 后先量真实尺寸再挂载 Graph
   （如 measured 状态门控：骨架屏覆盖到测量完成；删除硬编码 900×560 依赖）；
3. 修复开屏爆炸：react-force-graph-2d 的 warmupTicks（首帧前预热迭代）或等效手段，
   让首次可见即为收敛布局；与现有 onEngineStop/pauseAnimation 逻辑不冲突；
4. StrictMode 双挂载用 ref 门控（项目已有 viewed ref 先例）确保引擎只初始化一次；
5. 回归：fixture 三档 + 真实数据；设置面板、悬停白热、sprite 渐变、maxZoom 不回归。

# 约束
- 只动 graph/page.tsx 挂载/尺寸/引擎初始化序列，不动绘制函数、数据流、设置面板功能。
- 不新增依赖。

# 验收标准
1. 归因结论明确（两次闪动各对应什么，有录制证据描述）。
2. 修复后从导航进入到图谱可交互：无尺寸跳变、无节点爆炸过程，最多一次平滑淡入。
3. dev（StrictMode）与生产构建行为一致；npm run lint / build 通过。
```

---

## Task D 提示词：知识点详情页新增编辑与删除

```
# 角色
你是本仓库（Next.js 16 深色"暗夜书房"知识库；v10 已有段级编辑 API 与标注体系）的工程师。
任务：知识节点（segment）详情页 /segments/[id] 目前只能"看"——补齐编辑与删除入口。
后端能力已全部存在，本次只做 UI 接线。

# 项目事实（已核实，直接引用）
- /segments/[id] 页面（src/app/segments/[id]/page.tsx）：正文 + 页脚记忆行 + 链接折叠区；
  grep 确认无任何 编辑/PATCH/删除/DELETE 入口——图谱节点点击进入后无法管理该节点。
- 后端现成：PATCH /api/segments/[id]（title/content/tags，记忆字段自动保留，wiki/tag 边
  自动重建）、DELETE /api/segments/[id]（级联清理边与标注，rebuildDocChain 重接相邻链）。
- v10 交互先例：src/components/SectionEditor.tsx（标题/mono textarea+预览/标签编辑，
  删除确认文案「其划线与笔记将一并删除，阅读历史不再保留」）；标注重定位（lib/annotations.ts
  locate 三级降级）会在内容变更后自动迁移该段标注，无需额外处理。
- /notes/[id] 的编辑模式已覆盖"在文档里编辑段落"，本次补的是"从节点自身页面直达"。
- 写码前先读 AGENTS.md。

# 任务
1. /segments/[id] 页头加「✎ 编辑」开关（复用 notes/[id] 编辑开关的样式与交互）；
2. 编辑态：该段渲染为编辑卡——标题/内容（mono textarea + 预览切换）/标签 + 保存/取消；
   实现二选一并说明取舍：(a) 复用 SectionEditor 加 prop 关闭结构操作（上移/下移/插入），
   (b) 抽轻量编辑卡组件；
3. 保存成功后回到渲染态并刷新详情（memory/档位/标注迁移即时反映）；
4. 删除：编辑态内「✕ 删除」→ window.confirm（沿用 v10 文案，含标注与阅读历史警示）→
   DELETE 成功后跳转回 /notes/<documentId>；文档已无其他段时跳转 /notes；
5. 阅读态视觉零变化（编辑是显式开关，延续 v10"阅读态纯净"原则）。

# 约束
- 不新增依赖；不改后端；不动 notes/[id] 既有编辑模式；375px 可用。
- 记忆字段保留由后端保证，前端不展示"记忆数据保留"以外的额外提示。

# 验收标准
1. 详情页编辑标题/内容/标签：保存后页面与 GET /api/segments/[id] 一致；
   构造含标注的段落改内容，标注自动迁移或灰显（复用 v10 行为）。
2. 删除：确认后节点消失，文档详情段数减一，图谱对应节点消失；级联后无死链。
3. 阅读态（非编辑）渲染与改造前逐像素等价（人工对照）；lint/test/build 通过。
```

---

## Task A 提示词：统一服务端缓存（图谱加载与热点端点）

```
# 角色
你是本仓库（Next.js 16 + Drizzle/Neon 个人知识库）的工程师。任务：为高频读取端点建立
统一的服务端缓存层。背景：/api/graph 每次请求全表扫描 segments+links 并逐节点现算记忆度，
每次进入图谱页都付一次完整代价；概览 /api/stats、文档列表 /api/notes 同类问题。

# 项目事实（已核实，直接引用）
- 无任何读缓存。唯一缓存先例：src/lib/learner-profile.ts:163-174——模块级
  { at, value } + TTL 60s + invalidate 函数（:174 cachedProfile = null）。
- 热点端点现状：
  * GET /api/graph：segments 全表 leftJoin documents + links 全表 + 逐节点 memoryOf 现算；
  * GET /api/stats：档位 CASE 聚合 + 今日阅读数 + 最近文档；
  * GET /api/notes：文档列表 + SQL 聚合 avgMemory；GET /api/notes/[id]：文档 + 段含 content；
  * GET /api/ai/config：每次读 app_settings 表（getLlmSettings）。
- 写路径（失效触发点）：POST /api/notes（导入）、PATCH/DELETE /api/segments/[id]、
  POST /api/notes/[id]/segments、POST /api/segments/[id]/move、PATCH /api/notes/[id]、
  POST /api/segments/[id]/view（改 lastViewedAt → 记忆度变）、split/aggregate-apply
  （内部走段写，需确认其路径并覆盖）。
- 部署形态：当前本地 node 长驻（缓存有效）；Vercel 函数实例无状态——内存缓存是
  best-effort（warm 实例内有效），可接受（个人应用），汇报中注明该边界。
- 写码前先读 AGENTS.md。

# 任务
1. lib/cache.ts：模块级缓存工具——getCache<T>(key)/setCache(key, value, ttlMs=60_000)/
   invalidateCache(prefixOrKey)；容量上限 64 条（超出淘汰最旧）；风格与 learner-profile.ts
   的先例一致；
2. 接入读端点（key 约定）：
   * /api/graph → 'graph'（TTL 60s）；
   * /api/stats → 'stats'（TTL 60s）；
   * /api/notes → 'docs'；/api/notes/[id] → 'note:<docId>'（TTL 120s）；
   * /api/ai/config → 'ai-config'（TTL 300s，设置页保存时主动失效）；
   缓存命中跳过 DB；JSON 响应头加 X-Cache: HIT/MISS 便于验收；
3. 写失效接线（在上述写路径成功后调用 invalidateCache）：
   * 导入/段增删改/移动/应用拆解聚合 → 'graph' + 'stats' + 'docs' + 对应 'note:<docId>'；
   * view（阅读推进记忆度）→ 'graph' + 'stats'；
   * 文档 PATCH → 'docs' + 'note:<docId>' + 'graph'（节点 documentTitle 变）；
   * 设置保存 → 'ai-config'；
4. 明确不缓存：/api/segments/[id]（详情实时性优先，且已有标注迁移联动）、问答与 AI 类端点。

# 约束
- 零新增依赖；不改变任何响应体结构（只加快返回）；guard 鉴权在缓存判断之前。
- learner-profile.ts 的既有缓存不动（避免双重失效耦合）。

# 验收标准
1. 连续两次 GET /api/graph：第一次 X-Cache: MISS、第二次 HIT，且响应时间显著下降
   （汇报前后数值）；编辑任一段落后再次 GET graph → MISS（失效生效）且内容已更新。
2. 阅读某段（view）后 graph/stats 的记忆分布随之变化（失效正确）。
3. 设置页改模型后 /api/ai/config 立即反映（ai-config 失效正确）。
4. 拆解/聚合 apply 后图谱与列表同步更新（确认其写路径被失效覆盖）。
5. npm run lint、npm run test、npm run build 通过。
```

---

## Task B 提示词：概览页重定位——消除与图谱的"掌握度"表达冲突

```
# 角色
你是本仓库（Next.js 16 + Tailwind 4 深色"暗夜书房"知识库）的前端工程师兼产品设计师。
任务：解决概览页与关系图谱在"掌握程度"表达上的冲突——同一份数据两套编码、两个"状态看板"。
方向已定：概览从"状态看板"重定位为"行动面板"，状态的空间表达归图谱独占。

# 冲突分析（已核实的现状）
- 概览（src/app/page.tsx）：hero 统计卡（总数/未读/长明/今日阅读）+ 记忆档位分布条
  （MEMORY_TIER_META 四色段）+ 最近导入 + 今日先看（suggestion，已存在）。
- 图谱：节点亮度=记忆度（memoryColor 琥珀亮度梯度）+ 档位筛选四色点。
- 冲突点：① 同一"掌握度"数据两套视觉编码（分布条四色段 vs 图谱亮度渐变），用户需学两套
  语言；② 概览的分布/计数是对图谱已有信息的汇总复述——图谱一开全都有，概览作为看板价值低；
  ③ 概览缺"行动"：知道状态之后下一步做什么要自己跳页（今日先看是唯一的行动元素）。
- 结论：概览保留但重定位——回答"现在做什么"，不回答"总体状态如何"（那是图谱的事）。

# 项目事实（已核实，直接引用）
- 概览页 src/app/page.tsx：Stats 接口（total/byTier/readToday/recentDocuments/suggestion）；
  suggestion 为"薄弱×图谱中心性 top1"（/api/stats 已实现，纯规则零 LLM）；
  MEMORY_TIER_META（MemoryBadge.tsx，四档 dot 色未读 #55504a/微光/明亮/长明 #f2c069）；
  MEMORY_TIER_LABELS/MEMORY_TIER_ORDER（lib/memory.ts）。
- 图谱页筛选已支持按档位开关（tierOn）；/graph?fixture= 压测可用。
- /api/stats 返回结构不变是本任务前提（前端重排，不动后端；如需薄弱 top3 清单可扩展
  stats 返回 weakTop3——按图谱 adviceCandidates 同口径，服务端一处改动允许）。
- 写码前先读 AGENTS.md。

# 任务
1. 全站掌握度编码统一规范（落地为代码注释 + 执行）：
   列表/徽章/分布类元素一律用档位点色（MEMORY_TIER_META，四档离散）；
   亮度渐变（memoryColor）仅存在于图谱节点与其图例——概览不再出现亮度渐变；
2. 概览重排为行动面板（自上而下）：
   a. 「今日先看」提升为首位主卡（现状保留，视觉加权）；
   b. 新增「薄弱清单」：记忆最弱 3 项（复用 suggestion 口径扩展 weakTop3），
      每项一行（灯点 + 标题 + 跳转）；
   c. 新增「未读精选」：最新导入且未读的段落 top3（数据来自 stats 扩展或 notes 接口，
      取实现最简者，汇报说明）；
   d. 「最近导入」保留（已是行动入口）；
   e. hero 统计带保留但降权（次级尺寸）；分布条移除，原位置放一枚「在图谱中查看掌握分布 →」
      链接（跳 /graph），把空间状态表达完全交给图谱；
3. /api/stats 扩展 weakTop3（与 suggestion 同查询口径，一处 SQL），响应加字段不改旧字段；
4. 空态：无数据时行动面板显示引导导入（沿用现有空态风格）。

# 约束
- 零新增依赖；不改记忆模型与图谱页；MEMORY_TIER_META 色值不动。
- 概览信息层级：行动（先看/薄弱/未读）> 入口（最近导入/图谱）> 统计（hero 卡）。
- 375px 不破版；沿用 fade-up/token 体系。

# 验收标准
1. 概览不再出现亮度渐变与四色分布条；掌握度四档色点与图谱图例同源（MEMORY_TIER_META）。
2. 行动面板四块（先看/薄弱/未读/最近导入）齐全且每项可点击达；weakTop3 与图谱按
  "微光+未读"筛选的节点人工对照一致。
3. 空库/全部已读等边界不出现空区块；375px 无破版。
4. npm run lint、npm run test、npm run build 通过。

# 输出
- 直接改码实现；汇报：改动文件清单 + 按验收标准逐条 ✓/✗ 自验 + 一段两档宽度的表现描述。
```

---

## 验收矩阵（主线汇报对齐用）

| 任务 | 关键验收 | 回归红线 |
|---|---|---|
| C | 归因有据；加载最多一次平滑淡入 | 图谱全部既有交互（白热/sprite/maxZoom/面板） |
| D | 详情页可编辑可删除；标注迁移正常 | 阅读态视觉不变；记忆字段保留 |
| A | HIT/MISS 可观测；写失效正确 | 响应结构零变化；鉴权前置于缓存 |
| B | 概览行动化；编码统一 | /api/stats 旧字段不变；图谱页零改动 |

## 交付记录（2026-10-27 收尾）

| 任务 | 状态 | 落地位置 |
|---|---|---|
| C 图谱双闪动 | ✅ | `6cfcf3a` 首帧先测尺寸再挂载 + 自适应预热；`e86740e` 以收敛阈值替代硬冷却；`1c3069f` 按跨轮最坏 tick 成本收紧预热预算 |
| D 节点编辑/删除 | ✅ | `src/app/segments/[id]/page.tsx` 页头编辑开关；`src/components/SegmentEditCard.tsx` 标题/正文/标签编辑与删除（删除后按文档剩余段数回文档或 `/notes`）；切换段时以 id 为 key 重挂页面，编辑态不跨段残留 |
| A 服务端缓存 | ✅ | `a7579f1` 进程内 TTL 缓存与写后失效（`src/lib/cache.ts` + 热点读端点） |
| B 概览行动化 | ✅ | `dd0eaab` 行动面板重排与档位点色统一 |

收尾验证（仓库根目录）：`npm run lint` 通过；`npm run test` 13 个文件 / 119 条用例通过（含新增 `segment-edit-card.test.tsx`）；`npm run build` 通过。

> 测试配置补充：`vitest.config.ts` 显式限定 `src/**/*.{test,spec}.{ts,tsx}`，避免工作区中指向 `src` 的符号链接（`云端知识库/src`）导致同一批用例被收集两次。
