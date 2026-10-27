/**
 * 实测 d3-force-3d 每个 tick 的同步耗时（warmupTicks 的预算依据）。
 *
 * 与 force-graph 默认 force 配置对齐：forceLink(默认 distance 30)、
 * forceManyBody(默认 strength -30)、forceCenter(0,0)。
 * 每个规模跑 4 次，取「首个 tick」与「中位 tick」的最坏值（首 tick 含四叉树构建）。
 *
 * 用法：node artifacts/measure-tick-cost.mjs > artifacts/tick-cost-worst.json
 */
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';

const SIZES = [500, 1000, 2000, 3000, 5000, 8000];
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
  const linkCount = Math.round(n * 3);
  const links = Array.from({ length: linkCount }, () => ({
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

const rows = [];
for (const nodes of SIZES) {
  let worstFirst = 0;
  let worstMedian = 0;
  const trials = [];
  for (let t = 0; t < TRIALS; t += 1) {
    const r = measure(nodes, 1000 + nodes + t);
    trials.push({ firstMs: +r.firstMs.toFixed(2), medianMs: +r.medianMs.toFixed(2) });
    worstFirst = Math.max(worstFirst, r.firstMs);
    worstMedian = Math.max(worstMedian, r.medianMs);
  }
  rows.push({
    nodes,
    firstMs: +worstFirst.toFixed(2),
    medianMs: +worstMedian.toFixed(2),
    trials,
  });
  process.stderr.write(`nodes=${nodes} first=${worstFirst.toFixed(1)}ms median=${worstMedian.toFixed(2)}ms\n`);
}

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      method: 'node artifacts/measure-tick-cost.mjs，d3-force-3d 3.0.6，forceLink/forceManyBody/forceCenter 默认参数，每规模 4 次取最坏值',
      ticksPerTrial: TICKS,
      note: '首 tick 含四叉树构建；中位 tick 为第 2..150 次采样的中位数。8000 以上未实测。',
      worstCase: rows,
    },
    null,
    2,
  ),
);
