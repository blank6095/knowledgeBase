/**
 * 局部探索与路径高亮的纯逻辑（U4-1 / U4-2）。
 *
 * 约束：只读 links/nodes，不修改输入；输出集合/路径供绘制层使用。
 * - collectNeighborIds：BFS 收集 depth 阶邻居（含 seed），超过上限时优先保留浅层，
 *   同层按 id 字典序稳定截断（避免结果随 Map 插入顺序抖动）。
 * - shortestPath：把三类边（wiki/tag/doc）统一视为无向关系做 BFS，返回最短节点路径
 *   与每段关系的原始方向/类型；无路径返回 null。
 */
import { ends, type GraphLink } from './graph-state';

export interface PathEdge {
  source: string;
  target: string;
  kind: string;
}

export interface GraphPath {
  nodeIds: string[];
  edges: PathEdge[];
}

/** 无向边 key（用于绘制层判断某条边是否在路径上）。 */
export function pathEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 收集 seedIds 的 depth 阶邻居（含 seed 本身）。
 * 超过 maxNodes 时先满足浅层，再按 id 字典序稳定截断。
 */
export function collectNeighborIds(
  seedIds: Set<string>,
  adjacency: Map<string, Set<string>>,
  depth: 1 | 2,
  maxNodes = 300,
): Set<string> {
  const result = new Set<string>();
  for (const seed of [...seedIds].sort()) {
    if (result.size >= maxNodes) break;
    result.add(seed);
  }

  let frontier = new Set(seedIds);
  for (let level = 0; level < depth && frontier.size > 0; level += 1) {
    const next = new Set<string>();
    for (const id of [...frontier].sort()) {
      const neighbors = [...(adjacency.get(id) ?? [])].sort();
      for (const neighbor of neighbors) {
        if (result.has(neighbor)) continue;
        if (result.size >= maxNodes) break;
        result.add(neighbor);
        next.add(neighbor);
      }
      if (result.size >= maxNodes) break;
    }
    frontier = next;
  }
  return result;
}

interface Step {
  /** 到达当前节点的来源节点 */
  from: string;
  edge: PathEdge;
}

/**
 * 两个节点之间的最短路径（无向 BFS）。from === to 返回单节点路径；不连通返回 null。
 */
export function shortestPath(links: readonly GraphLink[], from: string, to: string): GraphPath | null {
  if (!from || !to) return null;
  if (from === to) return { nodeIds: [from], edges: [] };

  const adjacency = new Map<string, { id: string; edge: PathEdge }[]>();
  const add = (a: string, b: string, kind: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push({ id: b, edge: { source: a, target: b, kind } });
  };
  for (const link of links) {
    const [s, t] = ends(link);
    if (!s || !t || s === t) continue;
    add(s, t, link.kind);
    add(t, s, link.kind);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => (a.id === b.id ? a.edge.kind.localeCompare(b.edge.kind) : a.id.localeCompare(b.id)));
  }

  const prev = new Map<string, Step>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const step of adjacency.get(current) ?? []) {
      if (visited.has(step.id)) continue;
      visited.add(step.id);
      prev.set(step.id, { from: current, edge: step.edge });
      queue.push(step.id);
    }
  }
  if (!visited.has(to)) return null;

  const nodeIds: string[] = [to];
  const edges: PathEdge[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = prev.get(cursor);
    if (!step) return null; // 防御：visited 有但 prev 缺失
    edges.push(step.edge);
    nodeIds.push(step.from);
    cursor = step.from;
  }
  nodeIds.reverse();
  edges.reverse();
  return { nodeIds, edges };
}
