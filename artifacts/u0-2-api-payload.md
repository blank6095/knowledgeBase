# U0-2 `/api/graph` 载荷扩展（tags / summary / headingPath）— 证据

- 任务：task-2（owner: api-payload）
- 时间：2026-10-30
- 写作用域：`src/app/api/graph/route.ts`、`artifacts/u0-2-api-payload.md`（未触碰 `src/app/graph/`、`src/components/`、`docs/`、`package.json`）
- 未提交 git。

## 1. 改动摘要（只增不删）

唯一改动文件：`src/app/api/graph/route.ts`（80 行，原 87 行；减少的 7 行来自删除文件内重复的本地类型定义，无运行时逻辑删除）

| # | 位置（改动后行号） | 改动 |
| --- | --- | --- |
| 1 | L9 | 新增 `import type { GraphPayload } from '@/lib/graph/graph-types';`，复用 Lead 建立的共享契约 |
| 2 | L14–L27（原位置） | 删除文件内私有的 `interface GraphNode` / `interface GraphPayload`（与 `src/lib/graph/graph-types.ts` 重复定义），改由共享类型承担；编译期等价，无运行时影响 |
| 3 | L36–L38 | `select` 增加 `tags: segments.tags`、`summary: segments.summary`、`headingPath: segments.headingPath` |
| 4 | L61–L63 | 节点映射增加 `tags: r.tags`、`summary: r.summary`、`headingPath: r.headingPath` |

保持不变（已逐项核对）：

- 响应字段名仍为 `nodes` + `edges`（未改成 `links`）；
- 现有字段 `id / title / memory / viewCount / readingMs / documentTitle` 的取值表达式逐字未动；
- 缓存键 `const CACHE_KEY = 'graph'`、`CACHE_TTL_MS = 60_000`、`X-Cache: HIT / MISS / STALE` 三分支逻辑未动；
- `guard()` 鉴权、`withDbRetry`、`withStaleFallback`、`dbUnavailable()` 兜底未动；
- 边的查询与字段（`source / target / kind / weight`）未动。

> 说明：`src/app/api/graph/route.ts` 在我接手前已有未提交改动（Lead 早前加入的 `withDbRetry` / `withStaleFallback` / `dbUnavailable` 包装），因此 `git diff`（对比 HEAD）会显示 58 insertions / 42 deletions，其中**大部分不是本次改动**。为证明我的改动范围，我以“领取任务时读到的文件内容”作为 before 快照做了 `git diff --no-index`，增量只剩下面 4 处：

```diff
@@ import 区 @@
+import type { GraphPayload } from '@/lib/graph/graph-types';
 
-interface GraphNode { ... }
-interface GraphPayload { ... }          # 共 14 行，均为重复类型定义

@@ select 对象 @@
             documentTitle: documents.title,
+            tags: segments.tags,
+            summary: segments.summary,
+            headingPath: segments.headingPath,

@@ 节点映射 @@
         documentTitle: r.documentTitle,
+        tags: r.tags,
+        summary: r.summary,
+        headingPath: r.headingPath,
```

另有一处非功能性差异：原文件末行缺少换行（`\ No newline at end of file`），编辑后补上了行尾换行（HEAD 版本本就有换行，等于恢复原状）。

## 2. 字段映射表（DB 列 → 响应字段 → 类型）

| DB 列（`src/db/schema.ts`） | Drizzle 类型定义 | 响应字段 | TS 类型 | 可空性 |
| --- | --- | --- | --- | --- |
| `segments.tags`（L43，`text('tags').array().notNull().default('{}')`） | `string[]` | `nodes[].tags` | `string[]` | 非空数组，默认 `[]` |
| `segments.summary`（L51，`text('summary')`，无 notNull） | `string \| null` | `nodes[].summary` | `string \| null` | **可为 null**（尚未生成摘要时） |
| `segments.heading_path`（L41，`text('heading_path').notNull().default('')`） | `string` | `nodes[].headingPath` | `string` | 非空字符串，未填时为空串 `''` |
| `segments.id / title / viewCount / stability / reading_ms / last_viewed_at` | 见 schema | 现有字段 | 未变 | 未变 |
| `documents.title`（leftJoin） | `string \| null` | `nodes[].documentTitle` | `string \| null` | 未变 |

共享契约落点：`src/lib/graph/graph-types.ts` 的 `GraphNode`，三个扩展字段在接口里声明为**可选**（`tags?: string[]`、`summary?: string | null`、`headingPath?: string`），因为 `public/fixtures/*.json` 的历史压测数据不含这三列；而 `/api/graph` 的真实响应**总是包含**这三个键（值可能为 `[]` / `null` / `''`），UI 侧仍然需要对 `undefined` 做兜底。

## 3. 验证结果（静态/类型）

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm.cmd run typecheck`（即 `tsc --noEmit`） | **EXIT 0，无错误输出** | 全仓通过，说明 `GraphPayload` 的 `edges: GraphLink[]` 与 DB 查询结果（`source/target` 为 `string`）兼容，且我的 import 与映射无需断言 |
| `npx.cmd eslint src/app/api/graph/route.ts` | **EXIT 0，无告警/错误** | 单文件 lint |
| `git diff --stat -- src/app/api/graph/route.ts` | `1 file changed, 58 insertions(+), 42 deletions(-)` | 含 Lead 早前的未提交改动，见 §1 说明；我的增量经 `git diff --no-index` 单独取证 |

未执行项及原因（按 Lead 本轮口头指令调整，任务描述原要求真实 HTTP）：

- **未启动 dev server、未做真实 `GET /api/graph` 断言**。Lead 明确本轮只做静态/类型验证，避免与 QA 的 3100 端口及 Lead 的 `.next` 产物争用；真实 HTTP 字段验证（登录拿 cookie、逐节点断言三字段类型、统计空值率）移至**阶段 0 出口门禁**，由 QA 在 task-4 步骤 2 执行（端口 3101/3102）。
- 未新增单测（route 为薄壳，逻辑已由 typecheck + QA 契约验证覆盖）。

## 4. 后端契约说明（给 U0-1 / QA / 前端）

1. `GET /api/graph` 响应结构：

```jsonc
{
  "nodes": [
    {
      "id": "uuid",
      "title": "知识点标题",
      "memory": 0.42,                 // 读取时现算，[0,1]
      "viewCount": 3,
      "readingMs": 120000,
      "documentTitle": "文档标题 | null",
      "tags": ["索引", "B+树"],        // string[]，无标签时为 []
      "summary": "30 字摘要……" ,       // string | null，未生成时为 null
      "headingPath": "基础篇 > 索引原理" // string，未填时为 ""
    }
  ],
  "edges": [{ "source": "uuid", "target": "uuid", "kind": "wiki", "weight": 1 }]
}
```

2. **`summary` 可能为 `null`**：本地库 15 个 segment 大多未生成摘要，属预期，前端渲染摘要卡片时需按空态处理；`null` 与 `''` 语义不同（前者=未生成，后者=生成结果为空）。
3. **`tags` 可能为 `[]`**：DB 列 `notNull default '{}'`，不会返回 `null`，但可能为空数组；标签筛选需容忍空数组（不会命中）。
4. **`headingPath` 可能为 `''`**：面包屑渲染前需判空，避免出现孤立的 `>` 分隔符。
5. **fixture 数据无三字段**：`public/fixtures/*.json` 历史文件只含基础字段，UI 必须按 `GraphNode` 的可选字段处理（`node.tags ?? []`、`node.summary ?? null`、`node.headingPath ?? ''`），否则 `?fixture=` 压测模式取不到值。
6. **向后兼容**：本次只做字段追加 + 类型去重，无字段改名/删除，旧消费方（`/graph` 页面）无需同步改动即可继续工作。
7. **缓存语义**：响应缓存 60s（键 `graph`），`X-Cache` 可能为 `HIT` / `MISS` / `STALE`（DB 抖动时返回上一份快照）；QA 验证契约时若刚发生过写入，需注意 60s 缓存窗口，必要时等待过期或用 `X-Cache: MISS` 的首次请求取证。

## 5. 遗留风险

- **真实 HTTP 未验证**：三个字段是否真的出现在 JSON 里（而非仅在 TS 类型层面成立），要等阶段 0 门禁的 QA 实测确认。若 drizzle 的 `text().array()` 在某些 DB 驱动下返回 `null`（理论上不会，列 `notNull`），需在门禁时补 `?? []`。
- **文件 diff 归因**：`route.ts` 混有 Lead 早前的未提交改动，若有人以 `git diff` 判断本次改动范围，请参考 §1 的增量 diff，不要按 58/42 计。
- **类型来源单一**：`GraphPayload` 现在同时被 route 与 UI 引用，后续若 `GraphNode` 增字段，route 的节点映射必须同步（Missing property 会由 typecheck 拦住，属于预期防线）。
