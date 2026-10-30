# 阶段 0 性能门禁归因（A/B 实验）

> 采集：2026-10-30 19:45–19:56（Asia/Shanghai），同一台机器、同一 Chrome（HeadlessChrome/156）、同 `npm run perf:graph` 脚本（1440×900、headless、系统 Chrome）。
> 起因：改动后 perf 对比 10-29 的 `artifacts/graph-baseline.json`，graph-mid/large 出现 firstTick +25~33%、fps −22~30%，超出门禁 ≤10%。

## 实验矩阵（每个变体均为今日同一会话/同一空闲环境）

| 变体 | graph-small | graph-mid | graph-large(实际 8000 节点) | 说明 |
|---|---|---|---|---|
| 历史基线（10-29 22:55） | 1037 / 1666 / 144.3fps | 1071 / 16187 / 5.90fps | 1121 / 16100 / 3.43fps | 上一会话采集，不可复现（见结论） |
| A. 现状：深空背景 + 透明画布 | 950 / 1628 / 133.3fps | 1419 / 16543 / 4.60fps | 1412 / 16386 / 2.41fps | 改动后代码 |
| B. minimal 背景（关纹理） | 970 / 1601 / 142.0fps | 1520 / 16557 / 3.92fps | 1460 / 16638 / 2.22fps | 关闭 CSS 纹理层 |
| C. 不透明画布 + 无背景层 | 984 / 1615 / 134.8fps | 1419 / 16562 / 4.22fps | 1440 / 16695 / 2.38fps | 完全回退 U0-3 分层 |
| D. HEAD 旧版单体 page（补 perf 探针） | 917 / 1550 / 131.5fps | 1386 / 16509 / 4.19fps | 1458 / 16425 / 2.48fps | 重构前已提交版本（651→714 行含探针），作为同时代代码对照 |
| E. 现状 final（canonical） | 953 / 1586 / 135.3fps | 1409 / 16568 / 4.55fps | 1457 / 16468 / 2.56fps | 最终代码独立复跑，写入 `graph-baseline.phase0.json` |

## 结论

1. **不是本次重构的回归**：变体 A/B/C 的差异在运行噪声内（mid fps 3.92–4.60、large 2.22–2.56）；关闭背景层（C）没有恢复历史基线的 5.9/3.4。
2. **旧代码今天同样只有 ~4.2/2.5**：变体 D 用重构前已提交的 651 行单体 page（补上同一套 `__kbGraphFirstTick/__kbGraphEngineStop` 探针），mid/large 与现状持平甚至略低 → 历史基线的 5.9/3.4 属于**上一会话环境（负载/热状态）更优**，不是代码差异。
3. **引擎停止时间三档仅 +2~3%**，劣化集中在 firstTick（页面加载/首帧）与绘制帧率，与背景层、画布透明均无因果。
4. **门禁判定**：按「同环境 A/B 不劣于改动前代码」口径 **PASS**；历史基线跨会话不可复现，后续阶段统一用 `artifacts/graph-baseline.phase0.json` 作为**同环境对照基线**（跨天比较需同日 A/B，或接受 ±25% 的环境漂移）。
5. 已知遗留（非本次引入）：`scripts/measure-graph.mjs` 配置 graph-large=20000 但现有 fixture 是 8000，基线 `nodes` 字段是配置期望值；本报告以 fixture 实际 8000 节点为准。

## 证据文件

- `artifacts/perf-phase0-canonical.log` — 变体 E 原始日志；`artifacts/graph-baseline.phase0.json` — 新基线
- `artifacts/perf-headpage.log` — 变体 D（旧版代码）原始日志；`artifacts/graph-baseline.exp-headpage.json`
- `artifacts/graph-baseline.exp-minimal.json`、`artifacts/graph-baseline.exp-opaque.json` — 变体 B/C
- 变体 D 的操作：`git show HEAD:src/app/graph/page.tsx` → 补 `__kbGraphFirstTick/__kbGraphEngineStop/onEngineTick/onEngineStop` 探针 → 跑 perf → 恢复 `src/app/graph/page.tsx`（现为 14 行薄壳）
