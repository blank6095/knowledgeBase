# U2-1 搜索索引与匹配算法 — 性能实测

> 采集：2026-10-30 20:36（Asia/Shanghai），Node v22.20.0，`tsx` 直接运行 `src/lib/graph/graph-search.ts`。
> 数据：`public/fixtures/graph-large.json`（**8000 节点 / 33005 边**，fixture 无 tags/summary/headingPath，仅标题参与匹配）。
> 方法：`buildSearchIndex` 计时 1 次；每个查询先 warmup 5 次，再跑 100 次取 p95。

## 结果

| 指标 | 数值 |
|---|---|
| 索引构建（8000 节点） | **3.73 ms** |
| 查询 `网络` | p95 **1.31 ms**，max 7.08 ms（命中 972 节点，hits 截断 8） |
| 查询 `HTTP` | p95 0.37 ms（0 命中） |
| 查询 `Java` | p95 0.38 ms（0 命中） |
| 查询 `索引` | p95 0.54 ms（0 命中） |
| 超长/无命中查询 | p95 0.16 ms |

**结论：远低于 <50ms 的口径**（最坏 p95 1.31ms），索引只在 nodes 变更时重建一次（3.73ms）。

## 单测

`src/lib/__tests__/graph-search.test.ts`：**12 条通过**，覆盖空/空白查询、大小写、标题精确/startsWith/includes 排序、标签命中 detail、headingPath、summary 与 null、fixture 缺字段、同节点多字段去重、limit 截断不影响 matchedIds、超长查询、输入不可变。

## 说明

- fixture 数据没有扩展字段，真实库 15 个知识点含 tags（12 个空）/headingPath（15 个有值）/summary（14 个 null），标签/摘要命中在真实数据上按空值安全降级。
- 搜索纯函数只产出 `hits + matchedIds`，不修改输入节点；渲染层（U2-3）只读这两个结果。
