/**
 * 参数化关系图谱压测数据生成器。
 *
 * 拓扑模型：社区块模型 + 社区内 Barabási–Albert 优先连接（产生无标度度分布与
 * 枢纽节点）+ 跨社区枢纽桥接边（小世界特征）+ 预留孤立节点。
 * 输出与 /api/graph 同构的 JSON，可直接被 /graph?fixture=<name> 加载。
 *
 * 用法示例：
 *   node scripts/gen-graph-data.mjs --nodes 500 --communities 8 --avg-degree 8 \
 *     --out public/fixtures/graph-small.json --seed 42
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const { values: a } = parseArgs({
  options: {
    nodes: { type: 'string', short: 'n', default: '500' },
    communities: { type: 'string', short: 'c', default: '8' },
    'avg-degree': { type: 'string', short: 'd', default: '6' },
    'cross-ratio': { type: 'string', default: '0.08' }, // 跨社区边占比
    'hub-ratio': { type: 'string', default: '0.03' }, // 参与跨社区桥接的枢纽比例
    'isolated-ratio': { type: 'string', default: '0.02' }, // 孤立节点比例
    'new-ratio': { type: 'string', default: '0.3' }, // 强制「未学习」节点比例
    seed: { type: 'string', default: '42' },
    out: { type: 'string', default: 'public/fixtures/graph.json' },
  },
});

const N = int(a.nodes, 'nodes');
const C = Math.max(1, int(a.communities, 'communities'));
const D = Math.max(1, int(a['avg-degree'], 'avg-degree'));
const crossRatio = num(a['cross-ratio'], 'cross-ratio');
const hubRatio = num(a['hub-ratio'], 'hub-ratio');
const isolatedRatio = num(a['isolated-ratio'], 'isolated-ratio');
const newRatio = num(a['new-ratio'], 'new-ratio');
const seed = int(a.seed, 'seed');

// ---------- 可复现随机数（mulberry32） ----------
function mulberry32(s) {
  let t = s >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const ri = (n) => Math.floor(rand() * n);

const TOPICS = ['算法', '网络', '数据库', '前端', '后端', '运维', '安全', '数学', '语言', '工程实践', 'AI', '操作系统', '编译原理', '体系结构', '分布式', '测试'];

// ---------- 节点属性（与 /api/graph 字段同构） ----------
function deriveStatus(mastery) {
  if (mastery < 0.05) return 'new';
  if (mastery < 0.4) return 'learning';
  if (mastery < 0.75) return 'familiar';
  return 'mastered';
}
function mkNode(id, topic, label) {
  const isNew = rand() < newRatio;
  const mastery = isNew ? 0 : Math.min(1, Math.max(0.05, (rand() * 0.95) ** 1.4));
  return {
    id: `n${id}`,
    title: `${topic}·${label}`,
    mastery: Math.round(mastery * 100) / 100,
    status: deriveStatus(mastery),
    viewCount: isNew ? 0 : 1 + Math.floor(rand() ** 2.5 * 40),
    dueAt: new Date(Date.now() + rand() * 30 * 86400_000).toISOString(),
    tags: rand() < 0.6 ? [topic, TOPICS[ri(TOPICS.length)]] : [topic],
    documentId: `doc-${topic}-${ri(8)}`,
    documentTitle: `${topic}笔记`,
  };
}

// ---------- 社区内 BA 优先连接 ----------
function genCommunity(size, m, startId, topic, nodes, edges, seen) {
  const seedCount = Math.min(m + 1, size);
  for (let i = 0; i < seedCount; i++) nodes.push(mkNode(startId + i, topic, `${startId + i}`));
  for (let i = 1; i < seedCount; i++) {
    seen.add(edgeKey(startId, startId + i));
    edges.push({ source: `n${startId}`, target: `n${startId + i}`, ...edgeAttrs() });
  }
  const deg = new Map();
  for (let i = 0; i < seedCount; i++) deg.set(startId + i, seedCount - 1);

  for (let i = seedCount; i < size; i++) {
    const id = startId + i;
    nodes.push(mkNode(id, topic, `${id}`));
    // 度加权抽取 m 个不同目标
    const ids = [...deg.keys()];
    const total = ids.reduce((s, k) => s + deg.get(k) + 1, 0);
    const chosen = new Set();
    let guard = 0;
    while (chosen.size < Math.min(m, ids.length) && guard++ < m * 10) {
      let r = rand() * total;
      for (const k of ids) {
        r -= deg.get(k) + 1;
        if (r <= 0) {
          chosen.add(k);
          break;
        }
      }
    }
    for (const t of chosen) {
      const key = edgeKey(id, t);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: `n${id}`, target: `n${t}`, ...edgeAttrs() });
      deg.set(t, deg.get(t) + 1);
    }
    deg.set(id, m);
  }
}
function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function edgeAttrs() {
  // 社区内默认 doc/tag 混合；权重与应用语义一致（doc 弱、tag 中）
  return rand() < 0.55 ? { kind: 'doc', weight: 0.3 } : { kind: 'tag', weight: 0.5 };
}

// ---------- 组装 ----------
const isolatedCount = Math.round(N * isolatedRatio);
const active = N - isolatedCount;
if (active < C * (D + 2)) {
  console.error(`参数矛盾：active(${active}) 需 ≥ communities(${C}) × (avgDegree+2)`);
  process.exit(1);
}

// 社区大小：均值 ±40% 抖动
const sizes = Array.from({ length: C }, () => Math.max(D + 2, Math.round((active / C) * (0.6 + rand() * 0.8))));
let diff = active - sizes.reduce((s, x) => s + x, 0);
let idx = 0;
while (diff !== 0) {
  const i = idx++ % C;
  sizes[i] += diff > 0 ? 1 : -1;
  diff += diff > 0 ? -1 : 1;
}

const nodes = [];
const edges = [];
const seen = new Set();
const topics = [];
let startId = 0;
for (let ci = 0; ci < C; ci++) {
  const topic = `${TOPICS[ci % TOPICS.length]}${C > TOPICS.length ? Math.floor(ci / TOPICS.length) + 1 : ''}`;
  topics.push(topic);
  genCommunity(sizes[ci], Math.max(1, Math.round(D / 2)), startId, topic, nodes, edges, seen);
  startId += sizes[ci];
}
// 孤立节点
for (let i = 0; i < isolatedCount; i++) nodes.push(mkNode(startId + i, TOPICS[ri(TOPICS.length)], `孤岛${i}`));

// 跨社区枢纽桥接（小世界）：从高度数节点中按度加权挑两端
const degMap = new Map();
for (const e of edges) {
  degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1);
  degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1);
}
const hubs = [...degMap.entries()]
  .sort((x, y) => y[1] - x[1])
  .slice(0, Math.max(2, Math.round(N * hubRatio)))
  .map(([id]) => id);
const hubTopic = new Map(nodes.map((n) => [n.id, n.documentTitle]));
const crossTarget = Math.round(edges.length * crossRatio);
let added = 0;
let guard = 0;
while (added < crossTarget && guard++ < crossTarget * 20) {
  const s = hubs[ri(hubs.length)];
  const t = hubs[ri(hubs.length)];
  if (s === t || hubTopic.get(s) === hubTopic.get(t)) continue;
  const key = edgeKey(idNum(s), idNum(t));
  if (seen.has(key)) continue;
  seen.add(key);
  const wiki = rand() < 0.7;
  edges.push({ source: s, target: t, kind: wiki ? 'wiki' : 'tag', weight: wiki ? 1 : 0.5 });
  added++;
}

// ---------- 统计与输出 ----------
const finalDeg = new Map();
for (const e of edges) {
  finalDeg.set(e.source, (finalDeg.get(e.source) ?? 0) + 1);
  finalDeg.set(e.target, (finalDeg.get(e.target) ?? 0) + 1);
}
const degrees = nodes.map((n) => finalDeg.get(n.id) ?? 0).sort((x, y) => x - y);
const p = (q) => degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * q))];
const byStatus = nodes.reduce((acc, n) => ((acc[n.status] = (acc[n.status] ?? 0) + 1), acc), {});

const json = JSON.stringify({ nodes, edges });
mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(a.out, json);

console.log(`数据集已写入 ${a.out}`);
console.log(`节点: ${nodes.length} | 边: ${edges.length} | 平均度: ${(2 * edges.length / nodes.length).toFixed(1)}`);
console.log(`度分布: p50=${p(0.5)} p95=${p(0.95)} max=${degrees[degrees.length - 1]} | 孤立节点: ${degrees.filter((d) => d === 0).length} (${(degrees.filter((d) => d === 0).length / nodes.length * 100).toFixed(1)}%)`);
console.log(`状态分布: ${JSON.stringify(byStatus)}`);
console.log(`文件大小: ${(statSync(a.out).size / 1024 / 1024).toFixed(2)} MB`);

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} 需为正整数`);
  return n;
}
function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`--${name} 需为 0~1`);
  return n;
}
function idNum(id) {
  return Number(id.replace('n', ''));
}
