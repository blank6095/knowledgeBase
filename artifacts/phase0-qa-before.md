# 阶段 0 改动前基线取证（QA · before-phase0）

- 记录人：qa-phase0
- 采集时间：2026-10-30 19:26:55 – 19:29（Asia/Shanghai, UTC+8）
- 仓库：`D:\Project\knowledgeBase`
- 分支 / HEAD：`master` / `43c76568c7efdd4cfc4348e1579b7779cfd346b2`
- 工作区状态：采集时已有大量未提交改动（M/?? 共 84 行 `git status --short`），本报告只记录「采集瞬间」的事实，不含任何源码修改。
- 工具链：Node v22.20.0 / npm 10.9.3 / Playwright 1.64.1 / Next.js 16.4.3 (Turbopack) / Vitest 5.0.5
- 平台：win32，12th Gen Intel Core i7-12700H

> 本次仅做「改动前」取证：**未执行** `npm run build` 与 `npm run perf:graph`（留给改动后的出口门禁，避免覆盖 `artifacts/graph-baseline.json`）。

## 1. 结论速览

| 门禁 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 类型检查 | `npm run typecheck` | 0 | 通过（无输出） |
| 静态检查 | `npm run lint` | 0 | 通过（1 warning，0 error） |
| 单元/集成测试 | `npm test` | 0 | 35 文件 / 233 用例全部通过 |
| E2E | `npm run test:e2e` | 0 | 6 / 6 通过（自起 3100 dev server） |

四项全绿，**无既有失败**，因此改动后若出现红项，可直接判定为新增回归（环境因素除外，见 §6）。

## 2. fixture 规模（实际文件读数）

| fixture | 文件大小 (bytes) | nodes | edges | 脚本配置期望 nodes | 备注 |
| --- | --- | --- | --- | --- | --- |
| graph-small | 179,537 | 500 | 1,489 | 500 | 一致 |
| graph-mid | 2,234,824 | 5,000 | 20,753 | 5,000 | 一致 |
| graph-large | 3,579,419 | **8,000** | 33,005 | **20,000** | **不一致：实际只有 8000 个节点，不是脚本配置的 20000** |

fixture 文件指纹（本次未重新生成，mtime 均为 2026-10-25）：

```
graph-large.json  bytes=3579419  mtime=2026-10-25T12:11:33+08:00  sha256=12a461596c5247dd4f310e6ebc09ba05a787109f116259c8fdfa9b3b6ee10f57
graph-mid.json    bytes=2234824  mtime=2026-10-25T15:22:19+08:00  sha256=5c9e8de1244bca34e65b3a838eab3ad86367a484bd1aaade670f41bf34e7125c
graph-small.json  bytes=179537   mtime=2026-10-25T12:11:33+08:00  sha256=aeaea099e371ca169c17d618f451898a4c419b3c8881fb1ee621415bfb8c202d
```

差异根因（`scripts/measure-graph.mjs`）：

- 第 18 行配置 `{ name: 'graph-large', nodes: 20_000, ... }`；
- 第 25 行 `if (statSync(out, { throwIfNoEntry: false })?.size) continue;` —— **文件已存在且非空就跳过生成**，所以磁盘上的 8000 节点旧文件一直没被 20000 的配置覆盖。
- 连带证据：`artifacts/graph-baseline.json` 中 `graph-large` 记录 `"nodes": 20000`，但同一条记录的 `fixtureBytes` 是 `3579419`，与当前 8000 节点的文件大小完全一致 —— 说明基线里的 `nodes` 字段写的是「配置期望值」而非「实测节点数」。

**对出口门禁的影响**：改动后跑 `perf:graph` 时，`graph-large` 若仍复用旧文件，则 20000 档从未真正被测过；若届时删除 fixture 让脚本重新生成，节点数会从 8000 跳到 20000，耗时指标不可与前基线直接比较。建议在出口门禁阶段明确口径（继续用 8000 旧文件对照基线，或重新生成并重记一份基线）。

## 3. 基线文件备份

| 项 | 值 |
| --- | --- |
| 源文件 | `artifacts/graph-baseline.json`（1,201 bytes，capturedAt 2026-10-29T14:55:05.881Z） |
| 备份文件 | `artifacts/graph-baseline.before-phase0.json` |
| sha256（源） | `c781771d1e5f055fc64836bf854ef30bd78fa2f04ed86c6d3f39c9f0c4e6b269` |
| sha256（备份） | `c781771d1e5f055fc64836bf854ef30bd78fa2f04ed86c6d3f39c9f0c4e6b269` |

备份是一次性复制，复制前后及四项门禁跑完后均校验过哈希一致；**源文件未被覆盖或修改**，`perf:graph` 后续仍会写这两个路径中的原文件（`graph-baseline.json`）。

基线内三档数据（改动前，供出口门禁对照）：

| fixture | nodes(基线记录) | firstTickMs | engineStopMs | fps | p95FrameMs | maxLongTaskMs |
| --- | --- | --- | --- | --- | --- | --- |
| graph-small | 500 | 1037 | 1666.3 | 144.30 | 7.9 | 167 |
| graph-mid | 5000 | 1070.5 | 16186.5 | 5.90 | 227.8 | 164 |
| graph-large | 20000（实际 8000） | 1120.9 | 16099.9 | 3.43 | 400.0 | 232 |

## 4. 命令明细与耗时

| # | 命令 | 开始 | 结束 | 耗时 | 退出码 |
| --- | --- | --- | --- | --- | --- |
| 1 | `npm.cmd run typecheck` | 19:27:11.56 | 19:27:16.52 | 5.0 s | 0 |
| 2 | `npm.cmd run lint` | 19:27:18.46 | 19:28:14.96 | 56.5 s | 0 |
| 3 | `npm.cmd test` | 19:28:17.44 | 19:28:28.22 | 10.8 s（vitest 自报 7.19 s） | 0 |
| 4 | `npm.cmd run test:e2e` | 19:28:32.85 | 19:28:51.09 | 18.2 s | 0 |

### 4.1 typecheck

`tsc --noEmit`，无任何诊断输出，退出码 0。

### 4.2 lint

```
D:\Project\knowledgeBase\src\components\graph\GraphCanvas.tsx
  29:3  warning  'ends' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

- 退出码 0（warning 不阻断）。
- 唯一告警是 `GraphCanvas.tsx:29:3` 未使用的 `ends`，属**改动前既有告警**（该文件在采集时未被 `git status` 列为修改），非新增失败；出口门禁对比时若该告警消失属良性变化，若新增其他告警则视为回归信号。

### 4.3 test（Vitest）

```
Test Files  35 passed (35)
     Tests  233 passed (233)
  Duration  7.19s
```

- 覆盖包含本次阶段 0 相关面：`graph-mount-utils.test.ts`(13)、`ui-theme/ui-geometry/ui-contrast/ui-feedback` 等 UI 用例、`db-retry`/`db-resilience-route`/`cache-stale` 等韧性用例。
- stderr 中出现的 `[db-retry] ... ETIMEDOUT` / `[db-fallback] ... 返回陈旧快照` 是降级路径用例**故意**制造的输出，不是失败。

### 4.4 test:e2e（Playwright）

- 由 `scripts/run-e2e.mjs` 自动拉起 `next dev --hostname 127.0.0.1 --port 3100`（注入 `AUTH_PASSCODE=e2e-passcode`、`NEXT_TELEMETRY_DISABLED=1`），结束后自动停服。
- dev server 就绪：`✓ Ready in 765ms`；本机 .env.local 被加载；Cache Components / Partial Prefetching 开启。
- 6 个用例全部通过（`6 passed (7.1s)`）：

```
ok 1 e2e\auth-graph.spec.ts:46  登录后可加载 mock 知识图谱
ok 2 e2e\auth-graph.spec.ts:187 学习复盘展示周期对比和 14 天热力
ok 3 e2e\auth-graph.spec.ts:5   未登录访问页面会进入登录页
ok 4 e2e\auth-graph.spec.ts:81  主动回忆先作答，再揭晓答案并记录结果
ok 5 e2e\auth-graph.spec.ts:14  登录 next 参数不允许跳出当前站点
ok 6 e2e\auth-graph.spec.ts:126 选中正文后可请求 AI 解释且不跳转
```

- 完整原始日志：`artifacts/phase0-qa-before-e2e.log`（5,474 bytes）。
- 跑完后复查：3100 端口已释放（无 LISTEN），未残留 dev server 进程；本次运行期间未启动其他 dev server（3200 端口也确认空闲）。

## 5. 既有失败 vs 新增失败

| 类别 | 本次结论 |
| --- | --- |
| 既有失败 | **无**。四项门禁退出码全为 0，vitest 233/233、e2e 6/6 通过。 |
| 既有告警 | 1 条：`src/components/graph/GraphCanvas.tsx:29:3` 未使用变量 `ends`（`@typescript-eslint/no-unused-vars`），不阻断。 |
| 新增失败 | 本报告为「改动前」基准，暂无新增失败可判；改动后复跑同样四条命令 + build + perf:graph，任何红项即新增。 |

## 6. 环境性观察与风险提示

1. **3100 / 3200 端口采集前后均空闲**，e2e 自起自停未冲突；若出口门禁时有人占用 3100，`run-e2e.mjs` 会因端口冲突启动失败，属环境失败而非代码回归。
2. **e2e 依赖本地 `.env.local`**（dev server 输出 `Environments: .env.local`）。若该文件在改动后缺失/改名，e2e 会大面积失败，需先排除环境因素。
3. **fixture 20000 vs 8000 口径不一致**（见 §2），是最可能让出口门禁「误判性能回退/提升」的点，须先定口径再比数。
4. 本次跑 e2e 会写入 `test-results/`，未改动 `playwright-report/`（不存在）；属于运行产物，不进版本库。
5. 采集期间 Lead 可能正在新增未被引用的文件（未动 `page.tsx`）；本报告只反映该瞬间的 `HEAD + 工作区` 状态，之后若有新文件加入，typecheck/lint 结果可能变化，出口门禁需重跑而非复用本结论。

## 7. 复现方式

```powershell
cd D:\Project\knowledgeBase
Copy-Item artifacts/graph-baseline.json artifacts/graph-baseline.before-phase0.json
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e   # 自起 3100 dev server，结束自动停服
Get-FileHash -Algorithm SHA256 artifacts/graph-baseline.before-phase0.json
```

fixture 计数复核：

```powershell
node -e "const fs=require('fs');for(const n of ['small','mid','large']){const j=JSON.parse(fs.readFileSync('public/fixtures/graph-'+n+'.json','utf8'));console.log(n,j.nodes.length,j.edges.length)}"
```
