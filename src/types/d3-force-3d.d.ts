declare module 'd3-force-3d' {
  export interface ForceNode {
    fx?: number | null;
    fy?: number | null;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
  }

  export interface Force {
    (alpha: number): void;
    initialize?(nodes: ForceNode[]): void;
  }

  export interface ForceX extends Force {
    strength(value: number): ForceX;
    x(value: number): ForceX;
  }

  export interface ForceY extends Force {
    strength(value: number): ForceY;
    y(value: number): ForceY;
  }

  export interface Simulation {
    force(name: string): Force | undefined;
    force(name: string, force: Force | null): Simulation;
    nodes(): ForceNode[];
    nodes(nodes: ForceNode[]): Simulation;
    alpha(): number;
    alpha(value: number): Simulation;
    alphaMin(value: number): Simulation;
    alphaDecay(value: number): Simulation;
    velocityDecay(value: number): Simulation;
    tick(): Simulation;
    stop(): Simulation;
    restart(): Simulation;
  }

  export interface ForceCollide<N = ForceNode> extends Force {
    radius(): (node: N) => number;
    radius(value: number | ((node: N) => number)): ForceCollide<N>;
    strength(value: number): ForceCollide<N>;
    iterations(value: number): ForceCollide<N>;
  }

  export function forceX(x?: number): ForceX;
  export function forceY(y?: number): ForceY;
  export function forceCenter(x?: number, y?: number): Force;
  export function forceLink(links?: unknown[]): Force;
  export function forceManyBody(): Force;
  export function forceCollide<N = ForceNode>(radius?: number | ((node: N) => number)): ForceCollide<N>;
  export function forceSimulation(nodes?: ForceNode[]): Simulation;
}
