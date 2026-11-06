/**
 * 均匀网格空间索引：把命中检测与视口查询从 O(n) 降到 O(邻近单元)。
 * 纯数据结构，不依赖 DOM 与渲染框架，可独立测试。
 */

export interface SpatialPoint {
  readonly x: number;
  readonly y: number;
}

export interface IndexedNode extends SpatialPoint {
  readonly id: string;
  readonly radius: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

export class SpatialHash<T extends IndexedNode> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, T[]>();
  private items: readonly T[] = Object.freeze([]) as readonly T[];

  constructor(cellSize = 96) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('SpatialHash: cellSize 必须为正有限数');
    }
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.items.length;
  }

  get unit(): number {
    return this.cellSize;
  }

  /** 全量重建：节点按包围盒覆盖的单元登记，跨单元节点在查询时去重。 */
  rebuild(nodes: readonly T[]): void {
    this.cells.clear();
    this.items = Object.freeze([...nodes]) as readonly T[];
    for (const node of nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const radius = Number.isFinite(node.radius) ? Math.max(0, node.radius) : 0;
      const minX = Math.floor((node.x - radius) / this.cellSize);
      const maxX = Math.floor((node.x + radius) / this.cellSize);
      const minY = Math.floor((node.y - radius) / this.cellSize);
      const maxY = Math.floor((node.y + radius) / this.cellSize);
      for (let cx = minX; cx <= maxX; cx += 1) {
        for (let cy = minY; cy <= maxY; cy += 1) {
          const key = cellKey(cx, cy);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(node);
          else this.cells.set(key, [node]);
        }
      }
    }
  }

  /** 查询与矩形相交的节点；结果为稳定顺序（按节点在 items 中的顺序）。 */
  query(rect: Rect): readonly T[] {
    if (this.items.length === 0) return Object.freeze([]) as readonly T[];
    const minX = Math.floor(rect.x / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);
    const seen = new Set<string>();
    const result: T[] = [];
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const node of bucket) {
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          const r = Number.isFinite(node.radius) ? Math.max(0, node.radius) : 0;
          if (
            node.x + r < rect.x ||
            node.x - r > rect.x + rect.width ||
            node.y + r < rect.y ||
            node.y - r > rect.y + rect.height
          ) continue;
          result.push(node);
        }
      }
    }
    return Object.freeze(result) as readonly T[];
  }

  /** 返回距离 (x, y) 最近且在命中半径内的节点；无命中返回 null。 */
  hitTest(x: number, y: number, padding = 0): T | null {
    if (this.items.length === 0) return null;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const seen = new Set<string>();
    let best: T | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const node of bucket) {
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          const radius = Math.max(0, node.radius) + Math.max(0, padding);
          const distance = Math.hypot(node.x - x, node.y - y);
          if (distance <= radius && distance < bestDistance) {
            best = node;
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  }

  clear(): void {
    this.cells.clear();
    this.items = Object.freeze([]) as readonly T[];
  }
}
