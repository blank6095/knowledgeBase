/**
 * 设计令牌与视觉通道注册表。
 *
 * 对应执行版任务清单 T02 / §4「视觉属性唯一语义表」：
 * 每个视觉通道只表达一个语义，注册表即契约，渲染层不得越权复用。
 * DEC-01（T09 青色外环 / T18 待复习标记）在此以 `decisionPolicy` 表达，
 * 'pending' 是第三态：既不是保留也不是移除，等待 T02 评审注入结论。
 */

export type ChannelId =
  | 'brightness'
  | 'searchOpacity'
  | 'masteryRing'
  | 'dueMarker'
  | 'selectionHalo'
  | 'edgeEmphasis';

export interface VisualChannelSpec {
  readonly id: ChannelId;
  readonly meaning: string;
  readonly forbidden: readonly string[];
  /** 受 DEC-01 决策门控；pending 时不产生视觉信号，但也不删除通道能力 */
  readonly decisionGated: boolean;
}

export const VISUAL_CHANNELS: readonly VisualChannelSpec[] = Object.freeze([
  Object.freeze({
    id: 'brightness',
    meaning: '记忆新鲜度',
    forbidden: ['搜索匹配程度', '选中状态', '掌握结论'],
    decisionGated: false,
  }),
  Object.freeze({
    id: 'searchOpacity',
    meaning: '搜索匹配程度',
    forbidden: ['记忆状态', '掌握结论'],
    decisionGated: false,
  }),
  Object.freeze({
    id: 'masteryRing',
    meaning: '真实学习记录证据（不等同「已掌握」）',
    forbidden: ['待复习', '选中', '记忆亮度'],
    decisionGated: true,
  }),
  Object.freeze({
    id: 'dueMarker',
    meaning: '待复习状态',
    forbidden: ['记忆亮度', '搜索命中', '掌握结论'],
    decisionGated: true,
  }),
  Object.freeze({
    id: 'selectionHalo',
    meaning: '当前选中状态',
    forbidden: ['业务状态', '记忆状态'],
    decisionGated: false,
  }),
  Object.freeze({
    id: 'edgeEmphasis',
    meaning: '当前搜索或路径上下文',
    forbidden: ['记忆状态'],
    decisionGated: false,
  }),
] as const);

/** DEC-01 决策策略：pending=待 T02 评审；keep/remove 由评审结论注入。 */
export type DecisionChannelPolicy = 'pending' | 'keep' | 'remove';

export interface UniversePalette {
  readonly deepSpace: string;
  readonly space: string;
  readonly overlay: string;
  readonly explore: string;
  readonly ai: string;
  readonly mastery: string;
  readonly due: string;
  readonly edge: string;
  readonly edgeStrong: string;
  readonly text: string;
  readonly textFaint: string;
}

export const DEFAULT_PALETTE: UniversePalette = Object.freeze({
  deepSpace: '#080B16',
  space: '#11182A',
  overlay: '#1B2740',
  explore: '#75A7FF',
  ai: '#A78BFA',
  mastery: '#64D9C2',
  due: '#F3BB72',
  edge: 'rgba(117, 167, 255, 0.16)',
  edgeStrong: 'rgba(117, 167, 255, 0.72)',
  text: '#ECE6DA',
  textFaint: 'rgba(236, 230, 218, 0.55)',
});

export type BackgroundId = 'deep-space' | 'nebula' | 'cosmic-grid';
export type LineStyleId = 'plain' | 'emphasis';
export type NodeStyleId = 'orb' | 'minimal';

export interface UniverseTokens {
  readonly palette: UniversePalette;
  readonly background: BackgroundId;
  readonly lineStyle: LineStyleId;
  readonly nodeStyle: NodeStyleId;
  /** 动效：静态 / 轻量动态两档，第一版不做复杂粒子与持续动画 */
  readonly motion: 'static' | 'light';
  readonly node: {
    readonly baseRadius: number;
    readonly radiusPerDegree: number;
    readonly labelMinZoom: number;
    readonly maxLabels: number;
  };
  readonly search: {
    readonly dimOpacity: number;
  };
  readonly decisionPolicy: DecisionChannelPolicy;
}

export type UniverseTokensInput = Partial<Omit<UniverseTokens, 'palette' | 'node' | 'search'>> & {
  readonly palette?: Partial<UniversePalette>;
  readonly node?: Partial<UniverseTokens['node']>;
  readonly search?: Partial<UniverseTokens['search']>;
};

const DEFAULT_NODE = Object.freeze({
  baseRadius: 3.2,
  radiusPerDegree: 1.15,
  labelMinZoom: 0.55,
  maxLabels: 45,
});

const DEFAULT_SEARCH = Object.freeze({ dimOpacity: 0.22 });

/** 构造不可变令牌；未提供的字段取默认，避免调用方持有可变引用。 */
export function createTokens(input: UniverseTokensInput = {}): UniverseTokens {
  return Object.freeze({
    palette: Object.freeze({ ...DEFAULT_PALETTE, ...(input.palette ?? {}) }),
    background: input.background ?? 'deep-space',
    lineStyle: input.lineStyle ?? 'plain',
    nodeStyle: input.nodeStyle ?? 'orb',
    motion: input.motion ?? 'static',
    node: Object.freeze({ ...DEFAULT_NODE, ...(input.node ?? {}) }),
    search: Object.freeze({ ...DEFAULT_SEARCH, ...(input.search ?? {}) }),
    decisionPolicy: input.decisionPolicy ?? 'pending',
  });
}

/** 返回受 DEC-01 门控的通道集合，供评审与验收查询。 */
export function decisionGatedChannels(): readonly ChannelId[] {
  return VISUAL_CHANNELS.filter((channel) => channel.decisionGated).map((channel) => channel.id);
}
