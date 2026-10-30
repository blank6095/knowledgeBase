/**
 * 图谱视觉主题单一出口（U3-1）。
 *
 * UQ8 拍板：切换冷色环境（4 套都很暗、以冷色为主），不再以暖琥珀作为 UI 主色；
 * 记忆度（未读→长明）的琥珀梯度保留为「数据语义色」，不随环境改变。
 *
 * 本模块只放纯数据与判定函数；应用环境 = 在 <html data-graph-env="…"> 上切换，
 * 具体色值由 globals.css 的 CSS 变量提供（切换不请求接口、不触发重排）。
 */

export type GraphEnvironmentId = 'deep-space' | 'digital' | 'aurora' | 'minimal';

export type GraphNodeStyleId = 'orb' | 'crystal' | 'wire' | 'energy';

export interface GraphEnvironment {
  id: GraphEnvironmentId;
  label: string;
  description: string;
  /** 用于面板色卡的三个代表色（环境底色/主色/强调色） */
  swatches: [string, string, string];
}

export interface GraphNodeStyle {
  id: GraphNodeStyleId;
  label: string;
  description: string;
}

export interface GraphPreferences {
  version: 1;
  environment: GraphEnvironmentId;
  nodeStyle: GraphNodeStyleId;
  /** 节点光晕强度倍率（0.5–1.8） */
  glow: number;
  /** 背景纹理/环境光强度倍率（0.4–1.5） */
  background: number;
}

export const GRAPH_ENVIRONMENTS: readonly GraphEnvironment[] = [
  {
    id: 'deep-space',
    label: '深空',
    description: '冷墨蓝底 + 冰青主色，默认环境',
    swatches: ['#0a1020', '#5cc8e6', '#060c18'],
  },
  {
    id: 'digital',
    label: '数字空间',
    description: '近黑蓝 + 电光青，对比更锐利',
    swatches: ['#070b12', '#66d9ff', '#04070c'],
  },
  {
    id: 'aurora',
    label: '极光',
    description: '深海青 + 极光绿，静谧微光',
    swatches: ['#08131a', '#7be0c0', '#050d12'],
  },
  {
    id: 'minimal',
    label: '极简',
    description: '中性冷灰 + 冰白，低装饰',
    swatches: ['#0f1216', '#cfe0ef', '#0a0d11'],
  },
] as const;

export const GRAPH_NODE_STYLES: readonly GraphNodeStyle[] = [
  { id: 'orb', label: '光点', description: '径向光球（默认）' },
  { id: 'crystal', label: '晶体', description: '菱形切面 + 描边' },
  { id: 'wire', label: '线框', description: '空心光环 + 细描边' },
  { id: 'energy', label: '能量球', description: '双环 + 中心核' },
] as const;

export const DEFAULT_GRAPH_PREFERENCES: GraphPreferences = {
  version: 1,
  environment: 'deep-space',
  nodeStyle: 'orb',
  glow: 1,
  background: 1,
};

const ENV_IDS: readonly GraphEnvironmentId[] = GRAPH_ENVIRONMENTS.map((env) => env.id);
const STYLE_IDS: readonly GraphNodeStyleId[] = GRAPH_NODE_STYLES.map((style) => style.id);

export function isGraphEnvironmentId(value: unknown): value is GraphEnvironmentId {
  return typeof value === 'string' && (ENV_IDS as readonly string[]).includes(value);
}

export function isGraphNodeStyleId(value: unknown): value is GraphNodeStyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value);
}

export function environmentById(id: GraphEnvironmentId): GraphEnvironment {
  return GRAPH_ENVIRONMENTS.find((env) => env.id === id) ?? GRAPH_ENVIRONMENTS[0];
}

export function nodeStyleById(id: GraphNodeStyleId): GraphNodeStyle {
  return GRAPH_NODE_STYLES.find((style) => style.id === id) ?? GRAPH_NODE_STYLES[0];
}

/** 把环境写到 <html data-graph-env>，CSS 变量随属性切换；SSR 下安全 no-op。 */
export function applyGraphEnvironment(environment: GraphEnvironmentId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.graphEnv === environment) return;
  root.dataset.graphEnv = environment;
}
