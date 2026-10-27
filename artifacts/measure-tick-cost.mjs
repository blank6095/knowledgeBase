/**
 * 实测 d3-force-3d 每个 tick 的同步耗时（warmupTicks 的预算依据）。
 *
 * 与 force-graph 默认 force 配置对齐：forceLink(默认 distance 30)、
 * forceManyBody(默认 strength -30)、forceCenter(0,0)。
 * 每个规模每轮跑 4 次、共 REPEATS 轮；每个规模取所有轮次里的最坏值。
 * 单次运行的耗时波动可达 1.5 倍以上，所以必须跨轮取最坏值，不能只跑一轮。
 *
 * 用法：node artifacts/measure-tick-cost.mjs [输出路径]
 * 默认直接以 UTF-8 写入 artifacts/tick-cost-worst.json —— 不要用 PowerShell 的
 * `>` 重定向，那会写成 UTF-16，让 git 把文件识别成二进制、程序也无法按 UTF-8 解析。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'tick-cost-worst.json'));

const SIZES = [500, 1000, 2000, 3000, 5000, 8000];
const REPEATS = 3;
const TRIALS = 4;
const TICKS = 150;

/** 稳定 PRNG，保证每次生成的拓扑一致 */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(n, seed) {
  const rand = mulberry32(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: i }));
  const links = Array.from({ length: Math.round(n * 3) }, () => ({
    source: Math.floor(rand() * n),
    target: Math.floor(rand() * n),
  }));
  return { nodes, links };
}

function measure(n, seed) {
  const { nodes, links } = build(n, seed);
  const sim = forceSimulation(nodes)
    .force('link', forceLink(links).id((d) => d.id))
    .force('charge', forceManyBody())
    .force('center', forceCenter(0, 0))
    .stop();

  // 丢弃前 5 个 tick，避开 JIT 冷启动
  for (let i = 0; i < 5; i += 1) sim.tick();

  const first = performance.now();
  sim.tick();
  const firstMs = performance.now() - first;

  const samples = [];
  for (let i = 1; i < TICKS; i += 1) {
    const t = performance.now();
    sim.tick();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const medianMs = samples[Math.floor(samples.length / 2)];
  sim.stop();
  return { firstMs, medianMs };
}

/** 一轮完整采样：每个规模 4 次，返回该轮每个规模的最坏值 */
function runRound(round) {
  const rows = [];
  for (const nodes of SIZES) {
    let worstFirst = 0;
    let worstMedian = 0;
    for (let t = 0; t < TRIALS; t += 1) {
      const r = measure(nodes, 1000 + nodes + t + round * 100);
      worstFirst = Math.max(worstFirst, r.firstMs);
      worstMedian = Math.max(worstMedian, r.medianMs);
    }
    rows.push({ nodes, firstMs: +worstFirst.toFixed(2), medianMs: +worstMedian.toFixed(2) });
  }
  process.stderr.write(`round ${round + 1}/${REPEATS} done\n`);
  return rows;
}

const runs = Array.from({ length: REPEATS }, (_, round) => runRound(round));
const worstCase = SIZES.map((nodes, i) => ({
  nodes,
  firstMs: +Math.max(...runs.map((r) => r[i].firstMs)).toFixed(2),
  medianMs: +Math.max(...runs.map((r) => r[i].medianMs)).toFixed(2),
}));

const payload = {
  measuredAt: new Date().toISOString(),
  method:
    'node artifacts/measure-tick-cost.mjs，d3-force-3d 3.0.6，forceLink/forceManyBody/forceCenter 默认参数，每轮每规模 4 次、共 3 轮，跨轮取最坏值',
  trialsPerSizePerRun: TRIALS,
  runs,
  worstCase,
  note: '首 tick 含四叉树构建；中位 tick 为第 2..150 次采样的中位数。8000 以上未实测。worstCase 为跨轮最坏值，即预算计算所用数据。',
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
process.stdout.write(`wrote ${OUT}\n`);
for (const row of worstCase) process.stdout.write(`${row.nodes}\t${row.firstMs}\t${row.medianMs}\n`);
