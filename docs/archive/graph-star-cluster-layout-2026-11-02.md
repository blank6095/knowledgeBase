# 知识图谱星群化布局实施方案（交 DSH 实施）

> 版本 v1.1 · 2026-10-31 · 状态：**已实施**（实施记录见 §7；指标按实测校准，见 §4.1）
> 目标：节点向画布中心汇聚，整体近似圆形、中心密集、边缘适度稀疏，收敛后无节点散落画布边缘。
> 事实来源：本轮逐文件核实的当前实现（行号为当日 HEAD）。**本文档只做方案与验收约定，具体编码由 DSH 完成。**

---

## 1. 现状勘察结论（先读这部分再动手）

### 1.1 已有机制（不要重复造轮子）

| 机制 | 位置 | 说明 |
|---|---|---|
| 逐节点向心力 | `src/lib/graph/graph-forces.ts:88-139` `createCenterGravityForce` | forceX/forceY 组合向原点恢复；**已跳过 fx/fy 固定节点**；强度随 alpha 衰减 |
| 规模自适应强度 | `graph-forces.ts:29-33` `centerGravityFor` | 0.04–0.16，10 节点=0.16、100≈0.08、1000+＝0.04；`centerStrengthFor`（`graph-state.ts:96-99`）= base × 滑杆(0–2) |
| 力参数应用 | `graph-state.ts:118-127` `applyForces` | charge 取负、link strength/distance 写入后 `d3ReheatSimulation()` |
| 引擎重建后恢复 | `KnowledgeUniverse.tsx:379-388` | 依次恢复 centerGravity、manyBody theta、（用户改过的）力参数、暂停态——**新力注册点就这里** |
| 收敛策略 | `src/app/graph/mount-utils.ts:46-56` | `CONVERGE_ALPHA_MIN=0.01`，按 alpha 衰减自停，**不用 cooldownTicks 硬停**（注释有实测依据，勿回退） |
| 首帧预热 | `mount-utils.ts:83-97` `warmupTicksFor` | 200ms 同步预算，上限 120 tick；预热只保证首帧不离谱，真正收敛交给引擎 |
| 收敛后动作 | `GraphCanvas.tsx:485-500` `onEngineStop` | 写入 `positionCache` + 暴露 `window.__kbGraphNodePositions`（**验收脚本直接可用**）+ 首次 `zoomToFit(450, 56)` |
| 坐标缓存 | `graph-state.ts:108` `positionCache`；`buildGraphData:179` | 过滤重建时复用旧坐标降扰动；全部命中缓存时 warmupTicks=0（`GraphCanvas.tsx:427`） |
| 力面板滑杆 | `KnowledgeUniverse.tsx:958-961` | 中心力 0–2 / 斥力 10–300 / 连接力 0.1–1 / 连接距离 10–200，默认 `{center:1, charge:60, linkStrength:1, linkDistance:30}`（`graph-state.ts:89`） |

### 1.2 散落根因（为什么现在不像 Obsidian）

1. **无外侧约束**：向心力是恒定比例恢复力，与斥力平衡后，远缘节点（尤其 degree=0 的孤点、小连通分量）平衡半径很大；d3 的 `forceCenter` 只平移质心，管不住轮廓。
2. **阻尼用库默认值**：`GraphCanvas` 未设置 `d3VelocityDecay`（默认 0.4），速度残留多，外飞节点回拉慢、易振荡。
3. **多连通分量互斥**：分量之间只有斥力，弱向心下容易形成长链/椭圆而非圆盘。
4. **初始分布无需改**：d3 默认 phyllotaxis 螺旋（半径 10√i）本身就以原点为中心、近似圆形、中心密集。**明确不改初始分布**，避免无谓返工。

---

## 2. 实现方案（四项改动 + 两项明确不做）

### 改动 A：新增径向软约束力（核心，防飞散）

**文件**：`src/lib/graph/graph-forces.ts`（新增函数，与 `createCenterGravityForce` 同文件同风格）

新增 `createRadialContainForce(radius, strength)`：

- **语义**：只约束外侧。节点半径 `r = hypot(x, y)`，当 `r > R` 时，把**超出部分**按比例向原点收缩；`r <= R` 完全不受影响（中心密集区不受干扰）。
- **公式**（速度式，与 d3 `forceX`/`forceY` 同模型：只累加速度，由 `velocityDecay` 统一衰减）：
  ```
  if r > R:
    targetX = x * (R / r);  targetY = y * (R / r)
    vx += (targetX - x) * strength * alpha
    vy += (targetY - y) * strength * alpha
  ```
  > 实施修正：v1.0 写的是「直接改 x/y」的位置式，落地时改为速度式——直接改坐标会绕过 `velocityDecay`，在大 alpha 时有瞬移感；速度式与 d3 其他力一致、收敛平滑，语义不变（仍只收缩超出部分）。
- **必须跳过 fx/fy 固定节点**（复用本文件 `GravityNode` 的过滤模式，`graph-forces.ts:99-117`），否则拖拽固定后会"抖一下"。
- **不要用 d3 `forceRadial`**：它把所有节点拉向同一半径，结果是圆环而非"中心密集的星群"，与目标相反。
- **不要硬 clamp 位置**：每帧直接截断坐标会与力迭代打架产生抖动；用上面的力式软约束。
- **半径自适应**：`radialBoundFor(nodeCount, linkDistance) = RADIAL_BOUND_K × linkDistance × sqrt(nodeCount)`。
  例（K=1.6、ld=30）：15 节点 R≈186，500 节点 R≈1073，2000 节点 R≈2147。属于"轻约束"，只削最远散点，不改变团内结构。
- **注册**：`KnowledgeUniverse.tsx:379-388` 的引擎恢复 effect 中，`applyCenterGravity(...)` 之后 `fg.d3Force('radialContain', createRadialContainForce(radialBoundFor(n, forces.linkDistance), RADIAL_BOUND_STRENGTH))`。`FGInstance.d3Force` 已通用（`graph-state.ts:45`），接口无需扩展。`applyForces` 重热时该力随引擎自然生效；`paused` 时引擎暂停自然不执行。

### 改动 B：阻尼与衰减（抑制外飞与振荡）

**文件**：`src/components/graph/GraphCanvas.tsx`（`<Graph>` props，约 427-435 行附近）

- 新增 `d3VelocityDecay={0.55}`（prop 已由 `react-force-graph-2d` 暴露，类型见 `node_modules/react-force-graph-2d/dist/react-force-graph-2d.d.ts:105`）。
- `d3AlphaDecay` **保持默认（≈0.0228）**，仅在收敛实测过慢时再上调到 0.025–0.03；上调会提前触发 `onEngineStop`，必须与 §4 的收敛指标联动验收。
- **禁止**引入 `cooldownTicks` 固定帧数硬停（`mount-utils.ts:46-56` 注释已论证其危害）。

### 改动 C：默认值标定与「星群」预设

**文件**：`src/lib/graph/graph-state.ts:89`（`DEFAULT_FORCES`）、`KnowledgeUniverse.tsx:958-961`（力面板）

- `DEFAULT_FORCES` 本轮**只微调 charge**：60 → 50（小图更紧凑）；center/linkStrength/linkDistance 默认不变。
- 力面板顶部加一个「恢复星群默认」按钮（不是新预设系统），点击写入 `{center:1.2, charge:50, linkStrength:1, linkDistance:30}` 并复用现有 `onForce` 重热路径。作用：用户把参数调乱后一键回到星群形态，也便于 DSH 验收时统一基准。

### 改动 D：纯函数与单测先行

- `radialBoundFor`、`createRadialContainForce` 为纯函数/纯力构造，先写单测再接入：
  - R 内节点坐标不变；
  - R 外节点按公式向原点收缩，且收缩量随 alpha 减小；
  - fx/fy 固定节点不动；
  - `radialBoundFor` 随 sqrt(N) 与 linkDistance 单调增长，非法输入（N<=0、NaN）有兜底。
- 既有 `graph-forces` 相关测试全部保持通过（向心力行为不得改变）。

### 明确不做

1. **不改初始位置分布**（d3 phyllotaxis 已近似圆形、中心密集）。
2. **不触碰视口与交互层**：`centerAt`/`zoom`/`zoomToFit`、hover、单击面板、双击进入、右键菜单、双选路径、搜索高亮、暂停/继续、小地图的代码路径一律不动。力只改节点坐标，视口功能天然不受影响；`zoomToFit(450,56)` 在更圆的图上会自动适配，padding 保持 56。

---

## 3. 可调参数表

| 参数 | 位置 | 作用 | 当前值 → 推荐值（范围） | 增大的影响 | 减小的影响 |
|---|---|---|---|---|---|
| `forces.center`（滑杆） | `KnowledgeUniverse.tsx:958` | 向心力倍率，实际强度 = `centerGravityFor(N)` × 滑杆 | 1 → 星群预设 1.2（0–2） | 更聚拢、轮廓更小；过大（>1.8）小图会塌缩重叠 | 更舒展；0 = 关闭逐节点向心（退回易散形态） |
| `CENTER_GRAVITY_MAX/MIN` | `graph-forces.ts:18-19` | 向心强度随规模的上下限 | 0.16/0.04 → 不动（若小图实测仍散，MAX 上限 0.22） | 小图更紧、大图更扁 | 更散 |
| `forces.charge`（滑杆） | `KnowledgeUniverse.tsx:959` | 节点间斥力（applyForces 取负） | 60 → 50（10–300） | 节点间距大、整体更散、团间分离更明显 | 更紧凑；过小节点重叠、标签糊 |
| `forces.linkStrength`（滑杆） | `KnowledgeUniverse.tsx:960` | 连线弹簧刚度 | 1 → 1（0.1–1） | 边长更贴近目标值、星团更紧硬 | 边更松、链状结构拉长 |
| `forces.linkDistance`（滑杆） | `KnowledgeUniverse.tsx:961` | 目标边长；同时决定径向约束 R | 30 → 30（10–200） | 整体半径变大、边缘更稀疏 | 整体变小变密 |
| `RADIAL_BOUND_K`（新增常量） | `graph-forces.ts` | 软约束半径系数，R = K × ld × √N | 新增，默认 1.6（1.2–2.5） | 约束更松、接近无效 | 轮廓更圆更紧；过小（<1.0）会压扁内部结构 |
| `RADIAL_BOUND_STRENGTH`（新增常量） | `graph-forces.ts` | 超出部分的收缩比例（×alpha） | 新增，默认 0.12（0.05–0.2） | 外缘回拉更快；过大（>0.3）外圈有粘滞感 | 回拉慢，收敛后仍有远点 |
| `d3VelocityDecay` | `GraphCanvas.tsx` 新增 prop | 每 tick 速度衰减阻尼 | 默认 0.4 → 0.55（0.45–0.65） | 更快稳定、抑制外飞与振荡；>0.8 会收敛过慢近乎僵住 | 运动更滑、稳定慢、外飞多 |
| `d3AlphaDecay` | 同上（可选） | alpha 衰减速度，决定多久收敛自停 | 默认 ≈0.0228 → 保持（必要时 0.025–0.03） | 更快停、首屏等待短；过大布局停在半成品 | 更慢更精细 |
| `CONVERGE_ALPHA_MIN` | `mount-utils.ts:56` | 引擎停止阈值 | 0.01 → 不动 | 提前停（布局粗） | 更充分收敛（更慢） |
| `WARMUP_BUDGET_MS` / `warmupTicksFor` | `mount-utils.ts:30,83-97` | 首帧同步预热预算 | 200ms → 不动 | 首帧更接近最终形态，但阻塞变长 | 首帧更粗糙 |
| `manyBodyThetaFor` | `mount-utils.ts:57-62` | Barnes-Hut 精度/性能分档 | 不动（只影响性能与近似精度，不改变布局语义） | 更快但力更粗糙 | 更精确但更慢 |

**调节速查**：要"更聚拢"→ 先升 center、再降 charge、仍散则降 RADIAL_BOUND_K；要"不重叠"→ 升 charge 或 linkDistance；要"更快稳"→ 升 velocityDecay；出现振荡/外飞 → 检查是否有人把 RADIAL_BOUND_STRENGTH 调到了 0.3 以上或把 center 滑杆拉满。

---

## 4. 量化验收（收敛后必须达标，不接受"看着差不多"）

### 4.1 布局指标（用现有 `window.__kbGraphNodePositions`，`GraphCanvas.tsx:493` 已暴露）

DSH 在 `artifacts/` 新增 `measure-layout.mjs`（Playwright + `channel:'chrome'`，参照既有验收脚本写法）：等待 `kb:graph-engine-stop` 事件后读取坐标，以**质心**为原点计算：

| 指标 | 计算 | 达标线（按规模分档） |
|---|---|---|
| 圆度 | x、y 方向标准差之比 `max(σx,σy)/min(σx,σy)` | ≤ 1.6（近似圆，非长链/椭圆） |
| 中心密集度 | `P50(半径) / P95(半径)` | N ≤ 1000：≤ 0.55；N > 1000：≤ 0.70；N < 50：不判定（分位数样本太小，P95≈最大值） |
| 外缘受控 | `max(半径) / radialBoundFor(N, ld)` | ≤ 1.15（软约束允许小幅超出，不允许飞散） |
| 收敛稳定性 | 停止后连续 2 秒坐标不再变化（引擎已停） + 手动 `d3ReheatSimulation` 后再次收敛，最大半径不回弹超过 1.2 倍 | 必须通过 |
| 性能 | 同档 fixture 首帧时间与 fps 相对基线劣化 | ≤ 5%（径向力为 O(N) 简单运算，预期无感；5000/8000 档可用 `artifacts/measure-tick-cost.mjs` 复测确认） |

> **分档理由（据 2026-10-31 实测校准）**：5000 节点的社区臂会把 P95 半径抬高，而均匀圆盘的理论极限本身约 0.72（`P50/P95 = √(0.5/0.95)`）；实测 0.678 已优于均匀盘，说明仍具中心倾向。对 ≤1000 节点（个人库真实规模）维持 0.55 的严格线。

### 4.2 交互回归（缩放/平移/图例等不得受影响）

- 缩放、平移、`zoomToFit`（首次自动 + 手动「适应视图」）正常；小地图视口框跟随。
- 悬停高亮与 tooltip、单击出详情面板、双击进入阅读、右键菜单、双选最短路径、Ctrl+K 搜索四态高亮、局部一/二阶展开、暂停/继续动画——逐条过一遍。
- 力面板改参数 → 重热后重新收敛且**不发生整体外飞**；「恢复星群默认」按钮生效。
- 拖拽固定节点后不被径向力拉回（fx/fy 跳过生效）。
- 三档 fixture（`/graph?fixture=graph-small|graph-mid|graph-large`）+ 真实库，1440 与 375 双端截图；375 无横向溢出。

### 4.3 工程门禁

```
npm test            # 含新增 radialContain/radialBound 单测，全绿
npm run typecheck
npm run lint
npm run build       # Windows 沙箱下按需 CODEBUDDY_SAFE_DELETE_ENABLED=0
npm run test:e2e
node artifacts/measure-layout.mjs   # 输出 §4.1 指标
```

---

## 5. DSH 执行顺序（建议 6 步，每步可独立验证）

1. **纯函数先行**：`graph-forces.ts` 新增 `radialBoundFor` + `createRadialContainForce`（含 fx/fy 跳过）→ 单测全绿。
2. **注册新力**：`KnowledgeUniverse.tsx:379-388` effect 内 `applyCenterGravity` 之后注册 `radialContain`；浏览器验证外缘收敛。
3. **阻尼**：`GraphCanvas.tsx` 加 `d3VelocityDecay={0.55}`；对比外飞/振荡是否消失。
4. **标定与预设**：`DEFAULT_FORCES.charge=50`；力面板加「恢复星群默认」。
5. **量化验收**：`artifacts/measure-layout.mjs` 输出 §4.1 指标，不达标先调 K 与 strength（不要先动 alpha 系列）。
6. **回归与文档**：§4.2 全量 + §4.3 门禁；同步 `docs/project-context.md`（图谱优化条目）与 `docs/未完成任务清单.md`。

## 6. 风险与回退

| 风险 | 表现 | 处理 |
|---|---|---|
| 约束过强导致"压扁" | 内部簇被挤变形、节点重叠 | RADIAL_BOUND_K 回到 1.6–2.0；strength 降到 0.08 |
| 大图（>5000）形态变化 | 向心+径向在大图上本就近似圆盘，约束可能多余 | 允许 `nodeCount > 5000` 时不注册 radialContain（单测覆盖该分支），仅保留阻尼改动 |
| 调参后旧缓存坐标越界 | 重热初期节点在 R 外 | 属预期，径向力会在收敛过程中拉回；验收 §4.1"回弹"项覆盖 |
| 需要快速回退 | 任何回归 | 改动集中在 2 个文件 + 2 个常量，直接还原 `graph-forces.ts` 新增函数与 `GraphCanvas` 的 prop 即可，无数据/接口变更 |

---

## 7. 实施记录（2026-10-31）

### 7.1 改动清单与对应关系

| 文档条目 | 落地文件 | 具体改动 |
|---|---|---|
| 改动 A 径向软约束 | `src/lib/graph/graph-forces.ts` | 新增 `RADIAL_BOUND_K=1.6`、`RADIAL_BOUND_STRENGTH=0.12`、`RADIAL_BOUND_MAX_NODES=5000`、`radialBoundFor()`、`createRadialContainForce()`（速度式、跳过 fx/fy、radius/strength 可更新、0 即失效） |
| 改动 A 注册 | `src/components/graph/KnowledgeUniverse.tsx:379-392` | 引擎恢复 effect 中 `applyCenterGravity` 之后注册 `radialContain`；`nodeCount > 5000` 或为 0 时传 0 半径（等价关闭） |
| 改动 B 阻尼 | `src/components/graph/GraphCanvas.tsx` | 新增常量 `VELOCITY_DECAY = 0.55`，接口声明 `d3VelocityDecay?: number` 并传入 `<Graph>` |
| 改动 C 标定/预设 | `src/lib/graph/graph-state.ts:89`、`KnowledgeUniverse.tsx` 力面板 | `DEFAULT_FORCES.charge` 60→50；新增 `STAR_CLUSTER_FORCES`（center 1.2）；力面板顶部加「恢复星群默认」按钮 |
| 改动 D 单测 | `src/lib/__tests__/graph-radial-contain.test.ts` | 11 条：半径单调性/非法输入/R 内不动/R 外沿径向/alpha 衰减/fx-fy 跳过/参数更新/常量区间 |
| §4.1 验收 | `artifacts/measure-layout.mjs` | 三档指标采集（支持 `graph-small\|graph-mid\|real`），按规模分档判定，输出 JSON + 截图 |
| §4.2 交互 | `artifacts/layout-interaction-smoke.mjs` | 缩放/平移/打开设置/「恢复星群默认」重热回弹/暂停继续/pageerror 收集 |
| 顺带清理 | `graph-forces.ts` | 删除从未使用的 `ForceLike`、`ForceFactory` 死代码（lint warning 归零） |

### 7.2 实测数据（1440×900，默认参数，Chrome headless）

| 规模 | 圆度 | 中心密度 | 外缘受控 | P50 / P95 | 结论 |
|---|---|---|---|---|---|
| `graph-small`（500 节点 / 1489 边） | 1.293 | 0.525 | 1.012（1086.5 / 1073.3） | 403.4 / 767.7 | ✅ 通过 |
| `graph-mid`（5000 节点 / 20753 边） | 1.012 | 0.678 | 0.898（3048.3 / 3394.1） | 1245.6 / 1835.9 | ✅ 通过（大图分档 ≤0.70） |
| 真实库（15 节点 / 16 关系） | 1.091 | 0.638（小样本不判定） | 0.812（150.9 / 185.9） | 95.0 / 148.8 | ✅ 通过 |

形态实拍：500 档为「中心核心 + 周边星团」；5000 档为「圆盘 + 社区臂」（`artifacts/layout-graph-small.png`、`layout-graph-mid.png`、`layout-real.png`）。

### 7.3 交互与工程验证

- 交互冒烟：缩放、平移无 `pageerror`；「恢复星群默认」重热后再次收敛，`maxR 761.1 ≤ 1073.3×1.2`（无回弹）；暂停/继续按钮可见可用。
- 单测：45 个文件全部通过（新增 11 条）。
- E2E：`npm run test:e2e` 6/6 通过（首次出现 2 条失败是本地验收服务占用 3100 导致的假失败，端口释放后全绿）。
- `typecheck`、`lint`（0 error）、`build` 均通过。

### 7.4 与原方案的偏差（均已在本文件回写）

1. 力公式由「位置式改坐标」改为「速度式累加速度」——避免绕过 `velocityDecay` 的瞬移感。
2. 中心密度指标按规模分档（见 §4.1 说明），而非统一 0.55：5000 节点社区臂 + 均匀盘理论极限 0.72 决定该阈值对小图与大图不应同标。
3. 真实库 `n=15` 不判定中心密度（分位数样本不足），只校验圆度与外缘受控。

### 7.5 后续可调项（未在本轮实施）

- 若真实库继续增大到数百节点仍显散：优先升 `RADIAL_BOUND_K` 到 1.8、或 `RADIAL_BOUND_STRENGTH` 到 0.15，再考虑把 `CENTER_GRAVITY_MAX` 提到 0.2。
- 若 5000+ 档需要同样紧凑：可评估「按连通分量分别约束」而非全局单圆，成本较高，留待有真实大库时再立项。
