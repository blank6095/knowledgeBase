# 知识宇宙 vs Obsidian 图谱：系统性差距分析

> 版本 v1.0 · 2026-10-31 · 基准：Obsidian（全局图谱 / 本地图谱 / 反向链接面板 / 标签面板 / 快速切换器 / 未链接提及）
> 事实来源：本轮逐文件核实（行号为当日 HEAD 状态），与 `docs/knowledge-universe-tasks.md` 的 U 组任务交叉核对，**已落地的能力不再列为差距**。

## 0. 现状基线（已对齐或超越 Obsidian 的能力，避免误判）

| 能力 | 本项目现状 | 证据 |
|---|---|---|
| 图谱组件化与三层状态 | `KnowledgeUniverse` 容器 + 10 个子组件 + `src/lib/graph/*` 纯函数层 | `src/app/graph/page.tsx:10-14` |
| 搜索 | Ctrl/Cmd+K 浮层，标题/标签/headingPath/摘要四级评分（精确 100→摘要 50），↑/↓/Enter/Esc 键盘导航，命中四态视觉 | `src/lib/graph/graph-search.ts`、`GraphSearch.tsx:90-115` |
| 局部探索 | 详情面板「展开一阶/二阶关联」，BFS 收集邻居（上限 300 稳定截断） | `graph-focus.ts:32-60` |
| 双节点最短路径 | 双选模式 BFS 最短路 + 路径高亮 + 「AI 解释关联」+ `?path=` 带入 ask | `graph-focus.ts:71-118`、`KnowledgeUniverse.tsx:357-377,718` |
| 学习地图标记 | weak / due / today / hub 四类标记，独立视觉通道 | `graph-map.ts:1-40` |
| 节点编码 | 半径 √degree（`GraphCanvas.tsx:282`）、颜色=记忆度梯度、分组关键词覆盖色、悬停提亮标签限流 Top12 | `graph-state.ts:188-218` |
| 悬浮提示 | HTML tooltip（标题/文档/记忆档/阅读次数/时长），escapeHtml + 缓存 | `GraphCanvas.tsx:441-448` |
| 右键菜单 | 键盘可达（方向键/Enter），高度估算契约 | `GraphContextMenu.tsx` |
| 主题与偏好 | 4 环境 × 节点风格，localStorage v1 持久化，异常静默降级 | `graph-theme.ts`、`graph-preferences.ts` |
| 全站导航 | `AppShell` 已内嵌 `GraphNavigation` 悬浮窄导航（含 active 匹配、aria-label） | `src/components/AppShell.tsx`（grep 证实引用） |
| 反向链接（段详情页） | `/segments/[id]` 按方向分组：出链（本文提及）/ 入链（提及本文）/ 共同标签 | `segments/[id]/page.tsx:196-201` |
| 视口 | centerAt/zoom 平滑聚焦、zoomToFit、位置缓存降扰动、minimap | `graph-state.ts:42-56,108` |
| 压测门禁 | `?fixture=` 三档数据 + 压测徽标 | `KnowledgeUniverse.tsx:236-237` |

**结论**：图谱画布侧的"空间重构 / 搜索聚焦 / 主题系统 / 高级探索"已基本追平 Obsidian 图谱视图。**剩余差距集中在图谱之外的三个面：阅读视图、全局检索、标签体系**——即 Obsidian 的"双链笔记"本质（链接活在正文里），而本项目链接目前只活在图谱和段详情页里。

---

## 1. 差距清单（按影响程度排序）

### 🔴 高影响

#### G-1 阅读视图不渲染内联双链 —— 链接「看得见但点不了」

- **问题描述**：正文里写的 `[[目标标题]]` 已被 `WIKI_PATTERN` 解析并建成 wiki 边（`src/lib/links.ts:6-21`），但阅读视图 `notes/[id]/page.tsx:253` 用 react-markdown 原样渲染 `s.content`，`[[...]]` 显示为纯文本；全仓 grep 证实阅读页与 `highlight.ts` 均无 wiki 处理。
- **Obsidian 对照**：正文内 `[[链接]]` 实时高亮、可点击跳转、支持 `[[|别名]]`、悬停出页面预览。
- **影响程度：高**。理由：阅读是本产品主场景（`/notes/[id]` + `/study/*`），双链的核心价值是"读到一半顺藤摸瓜"；现在建立关联的成本收益严重不对称——写 `[[...]]` 只影响图谱，阅读时零反馈，用户没有动力继续写双链，图会越来越稀疏。
- **改进建议**：① 写一个 ~40 行的 remark 自定义插件（tokenizer 匹配 `[[...]]`），在 `md-body` 渲染时转为 `next/link`，目标不存在时按"断链"灰虚线样式显示（与 G-2 联动）；② 悬停预览复用 `/api/segments/[id]` 摘要。涉及：`notes/[id]/page.tsx`、`segments/[id]/page.tsx`（同样用 Markdown 渲染）、新增 `src/lib/remark-wikilink.ts`。零新增依赖可手写插件。

#### G-2 断链（未解析链接）被静默丢弃 —— 「待写知识点」无踪迹

- **问题描述**：wiki 建边 SQL 用 `JOIN segments t ON lower(btrim(target.match[1])) = lower(t.title)`（`links.ts:15-21`），目标标题不存在时该引用直接消失；全仓无 unresolved/断链概念（grep 空）。
- **Obsidian 对照**：断链在正文显示为灰色可点击链接，图谱中显示为虚线空心节点，点击即可创建对应笔记——这是 Obsidian「先写链接再补内容」工作流的基础。
- **影响程度：高**。理由：个人知识库的增长靠"撞见缺口"；断链是唯一的缺口信号，丢弃它等于把知识管理降级为知识存档。
- **改进建议**：① `links.ts` 增加一条收集 SQL：抽取 `[[target]]` 中无法匹配任何 title 的 (segmentId, target) 对，落一张轻表或实时查询；② 阅读页按 G-1 的插件灰显断链；③ 图谱可选显示拟节点（虚线圆、不计入 degree），默认关闭避免噪音。涉及：`src/lib/links.ts`、`/api/graph`、`GraphCanvas`。

#### G-3 全局检索缺失 —— Ctrl+K 只活在图谱页

- **问题描述**：`GraphSearch` 的 Ctrl/Cmd+K 监听挂在图谱组件内（`GraphSearch.tsx:90-115`），离开 `/graph` 即失效；`/notes` 列表仅有 title/tags 的前端 includes 过滤；全仓无全文搜索 UI。服务端其实已有关键词检索能力（`src/lib/rag.ts` 的 `retrieveByQuery`：标题×3+标签×2 打分），但只服务于 ask 内部。
- **Obsidian 对照**：快速切换器 Ctrl+O 全库模糊匹配文件名；全文搜索面板支持内容命中、片段高亮、按标签/路径过滤。
- **影响程度：高**。理由：知识库超过百段后，"找到看过的一段话"只能靠问 AI（走 LLM、有成本有延迟）或逐页翻；检索是四维度中用户感知最直接的短板，且服务端能力已存在，属于"有引擎没方向盘"。
- **改进建议**：分两步：① 最小落地——新建全局 `QuickSwitcher`（全站 Ctrl+K），复用 `graph-search.ts` 的索引与评分逻辑，数据源合并 `/api/graph` 节点字段；② 第二步——新增 `/api/search` 服务端检索（ILIKE 内容 + 复用 tokenize 分词），支持内容命中片段返回。涉及：新组件、`layout.tsx`（全局挂载，注意与图谱页内 search 互斥）。

#### G-4 标签聚合视图缺失 —— 共同标签边占了图的大头却无法按标签收敛

- **问题描述**：tags 数据链完整（段+文档标签 → tag 边，weight=交集数/3，`links.ts:33-50`），图谱筛选 tab 却只有记忆档×关系类型两组开关（`graph-state.ts:158-182 buildGraphData` 仅 tierOn/kindOn），无标签筛选；全站无标签聚合页（点标签看全部相关段）。标签目前的呈现仅四处：图谱边、详情面板 chips、段详情共同标签组、notes 列表搜索词。
- **Obsidian 对照**：标签面板按使用频次排序，点标签列出全部笔记；图谱可按标签过滤/染色，支持嵌套标签。
- **影响程度：高**。理由：导入拆解后标签是最主要的组织维度，tag 边数量通常远超 wiki 边；当库到几百段时，不按标签收敛的大图等于不可用，而这是纯数据已有的能力，缺口只在查询参数与 UI。
- **改进建议**：① 图谱「筛选」tab 增加标签多选（节点 tags 字段已在 graph API 载荷中，`buildGraphData` 加一个 tagOn 集合参数即可，纯函数可单测）；② 中期补 `/tags` 聚合页（tag → segments 列表，一条 group by SQL）。涉及：`graph-state.ts`、`KnowledgeUniverse.tsx` 筛选 tab。

### 🟡 中影响

#### G-5 悬停预览无内容 —— 看摘要必须点进详情面板

- **问题描述**：tooltip 是固定模板（标题/文档/记忆档/阅读次数，`GraphCanvas.tsx:441-448`），无摘要预览、不可滚动；graph API 节点载荷无 summary，详情面板的 summary 来自二次请求。
- **Obsidian 对照**：图谱悬停直接弹出页面预览浮窗（正文可滚动、可点击进入）。
- **影响程度：中**。理由：多一次点击 + 面板遮挡画布；但详情面板已覆盖"深入看"的需求，属于效率损耗而非功能缺失。
- **改进建议**：tooltip 模板追加两行截断摘要。需要 `/api/graph` 载荷加 summary 字段（U0-2 已扩过 tags/summary/headingPath，节点接口补齐即可），或 tooltip 懒加载 `/api/segments/[id]`（有缓存机制，成本可控）。

#### G-6 反向链接不在阅读流 —— 只在「恰好走到段详情页」时可见

- **问题描述**：出链/入链/共同标签分组只存在于 `/segments/[id]`（`:196-201`）；阅读视图 `notes/[id]` 无任何关联区块（grep 仅命中一句无关文案）；图谱详情面板「直接关联」为无向列表（`GraphDetailPanel.tsx:142-161`，KIND_LABELS 无方向）。
- **Obsidian 对照**：反向链接面板常驻编辑器右侧，区分"链接提及/未链接提及"，每条带上下文摘录。
- **影响程度：中**。理由：与 G-1 同根——阅读流与链接体系割裂；但段详情页已有方向分组，缺的是入口位置而非数据。
- **改进建议**：① `notes/[id]` 每段卡片底部加一行关联 chips（数据可随段列表批量返回，或复用详情接口缓存）；② 详情面板 neighbor 条目加方向指示（wiki 边 fromId→toId 方向已在 DB，`ends()` 丢弃了方向，绘制层保留即可）。

#### G-7 图谱关系无方向语义 —— 「谁提及谁」在画布上不可见

- **问题描述**：`computeHoverSet`/`computeLinkColor`/`shortestPath` 全部按无向处理（`graph-state.ts:130-156`、`graph-focus.ts:80-85` 显式双向加边）；箭头默认关闭（`arrows: false`）；weight 仅 tag 边有实义（交集/3），wiki/doc 恒 1。
- **Obsidian 对照**：图谱默认明确出链方向，可选箭头；本地图谱区分"传出/传入"。
- **影响程度：中**。理由：图谱作为"发现"工具时无向可接受（本项目定位如此），但论证型知识（A 引用 B）的方向丢了；好在数据层方向完整，属展示层取舍。
- **改进建议**：低成本方案——悬停节点时出链/入链用不同透明度或端点圆点区分；进阶——默认开 arrows 并做小尺寸箭头 sprite。不建议改 shortestPath 语义（双选路径本就应无向）。

#### G-8 无孤立节点处理 —— 新导入未关联的段散落画布成噪音

- **问题描述**：`buildGraphData` 不过滤 degree=0 节点；筛选 tab 无"隐藏孤立"项。
- **Obsidian 对照**：图谱设置有 "Orphans" 开关（隐藏无链接笔记）。
- **影响程度：中**。理由：连导入多篇后未写任何 `[[...]]` 的库，画布边缘会聚集大量孤点，首次体验的直接观感是"图谱没用"；degree 已在 `buildGraphData` 现算，过滤是一行逻辑。
- **改进建议**：「筛选」tab 加开关（默认关），`buildGraphData` 增加参数 + 单测；开关状态并入 preferences 持久化。

#### G-9 探索闭环断在「看完回不来」 —— 无 `?focus=` 反向定位

- **问题描述**：图谱→详情→`/segments/[id]` 是通的（`KnowledgeUniverse.tsx:1041-1045`），但段详情/阅读页没有任何"在图谱中查看"入口；图谱页仅解析 `?fixture=`（`:236`），不支持 `?focus=<segmentId>` 定位。全仓 grep 证实 `segments/[id]` 无 graph 引用。
- **Obsidian 对照**：笔记与图谱双向可达（"Reveal note in graph"）。
- **影响程度：中**。理由：探索是图谱的核心使用方式，断点使用户必须手动 Ctrl+K 重新找节点；实现成本低（URL 参数 + centerAt/zoom 已具备）。
- **改进建议**：`KnowledgeUniverse` 初始化读取 `?focus=`，加载完成后 `centerAt+zoom` 到该节点并自动打开详情面板；`segments/[id]` 页头加「在图谱中查看」链接。涉及：`KnowledgeUniverse.tsx`、`segments/[id]/page.tsx`。

#### G-10 搜索匹配对中文长尾弱 —— 无分词、无模糊

- **问题描述**：`searchGraph` 是纯子串匹配（title includes/tags includes/摘要 includes），未复用 `rag.ts` 已有的 `tokenize()` 中文分词；无拼音、无编辑距离模糊。结果列表无内容命中片段。
- **Obsidian 对照**：quick switcher 有 fuzzy scoring（子序列匹配）；全文搜索支持词组/正则。
- **影响程度：中**。理由：中文标题的"子串完整包含"要求偏高（如搜"遗忘曲线"匹配不到标题为"记忆的遗忘规律与复习曲线"的段）；分词函数现成，改动集中在 `bestMatch`。
- **改进建议**：`graph-search.ts` 的 `bestMatch` 增加分词级匹配档（tokenize(query) 每个词元分别 includes，得分低于完整 includes）；与 G-3 全局检索共用同一匹配层。

### 🟢 低影响

#### G-11 无未链接提及（unlinked mentions）

- **问题**：Obsidian 能提示"某段文字提到了标题 X 但未写成 `[[X]]`"。本项目无此概念。
- **影响程度：低**。理由：AI 拆解/聚合已在部分承担"建立关联"职责；个人库当前规模（4 文档/15 段量级）下收益有限。
- **建议**：与 G-2 同一 SQL 家族（content ILIKE title 且无对应 wiki 边），做成低频提示列表；**挂起条件：库 > 500 段或用户出现手动找关联的明确行为信号**。

#### G-12 分组规则仅支持标题关键词

- **问题**：`GroupRule.query` 只做 `title.includes`（`graph-state.ts:192-198`），不支持按标签/路径染色。
- **Obsidian 对照**：颜色组支持标签、路径、搜索语法多种规则。
- **影响程度：低**。理由：分组是高级功能，当前查询已覆盖"主题染色"主需求；索引层小写字段已备好。
- **建议**：query 支持 `#` 前缀路由到 tags 字段（`#学习` → tagsLower includes），一行分发的改动。

#### G-13 无 Canvas/嵌入类空间容器

- **问题**：Obsidian Canvas（白板）与媒体嵌入不存在；本项目 R2 附件本就是挂起的 C3 决策项。
- **影响程度：低**。理由：与"零新增依赖优先"的项目铁律冲突，且当前无使用信号。
- **建议**：维持挂起，跟随 C3（附件）决策一起评估，不单独立项。

---

## 2. 维度覆盖小结

| 维度 | 差距项 | 一句话结论 |
|---|---|---|
| 知识关联展示 | G-1、G-2、G-4、G-7、G-8 | 图谱侧已追平；**正文侧的双链/断链渲染是最大断层** |
| 导航 | G-3、G-6、G-9 | 图内导航完备；**跨页面的双向定位（图谱↔正文）与全局入口缺失** |
| 检索 | G-3、G-10 | 图内搜索已达优良水平；**全局检索与中文分词是短板，且服务端能力已有** |
| 交互 | G-5、G-11、G-12、G-13 | 悬停/右键/键盘已达标；剩余为锦上添花项，多数可挂起 |

## 3. 建议落地顺序（供排期参考，不在本文档内实施）

1. **第一批（高影响，相互耦合）**：G-1 内联双链渲染 → G-2 断链检测与灰显 → G-8 孤立节点开关（三者共享"链接可见性"语义，建议同一批验收）。
2. **第二批**：G-3 全局 QuickSwitcher → G-10 分词匹配（同一匹配层）。
3. **第三批**：G-4 标签筛选 → G-9 `?focus=` 反向定位 → G-6 阅读流关联行。
4. **随缘批**：G-5 tooltip 摘要、G-7 方向视觉、G-12 标签染色；G-11/G-13 挂起观察。

每批沿用既有门禁：三档 fixture 压测 + `npm run test:e2e` + 1440/375 实拍截图；纯函数（G-2 收集 SQL、G-4 buildGraphData、G-10 bestMatch）必须先补单测。
