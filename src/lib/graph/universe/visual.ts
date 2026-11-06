/**
 * 语义视觉编码：把「视觉事实 + 交互上下文」映射为绘制指令。
 *
 * 对应执行版任务清单 T02 / T09 / T12 / §4 视觉属性唯一语义表：
 * 亮度只由记忆新鲜度决定，透明度只由搜索匹配决定，两者互不覆盖。
 * 一个记忆新鲜度高但未命中搜索的节点，亮度必须保持不变。
 */

import type { NodeFacts } from './data';
import type { UniverseTokens } from './tokens';
import { VISUAL_CHANNELS } from './tokens';

export interface NodeViewContext {
  readonly hasQuery: boolean;
  readonly matched: boolean;
  readonly selected: boolean;
  readonly zoom: number;
}

export interface NodePaint {
  /** 0.35 ~ 1，仅由 memory 驱动 */
  readonly brightness: number;
  /** 0 ~ 1，仅由搜索匹配驱动 */
  readonly opacity: number;
  readonly ring: 'mastery' | null;
  readonly marker: 'due' | null;
  readonly halo: boolean;
  readonly labelVisible: boolean;
  readonly label: string;
}

export interface EdgeViewContext {
  readonly emphasized: boolean;
  readonly dimmed: boolean;
}

export interface EdgePaint {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}

const MIN_BRIGHTNESS = 0.35;

/**
 * 亮度是 memory 的纯函数，函数签名刻意不接收搜索上下文字段。
 * 这样「搜索不得覆盖记忆亮度」在结构层而非注释层得到保证。
 */
export function encodeBrightness(memory: number): number {
  const m = Number.isFinite(memory) ? Math.min(1, Math.max(0, memory)) : 0;
  return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * m;
}

export function encodeSearchOpacity(view: NodeViewContext, tokens: UniverseTokens): number {
  if (!view.hasQuery) return 1;
  return view.matched ? 1 : tokens.search.dimOpacity;
}

export function encodeNode(
  facts: NodeFacts,
  view: NodeViewContext,
  tokens: UniverseTokens,
): NodePaint {
  const labelVisible =
    view.zoom >= tokens.node.labelMinZoom &&
    (view.selected || view.matched || !view.hasQuery);

  return Object.freeze({
    brightness: encodeBrightness(facts.memory),
    opacity: encodeSearchOpacity(view, tokens),
    ring: facts.masteryEvidence === true ? 'mastery' : null,
    marker: facts.dueMarker === true ? 'due' : null,
    halo: view.selected,
    labelVisible,
    label: facts.title,
  });
}

export function encodeEdge(
  view: EdgeViewContext,
  tokens: UniverseTokens,
): EdgePaint {
  const strong = view.emphasized || tokens.lineStyle === 'emphasis';
  return Object.freeze({
    color: strong ? tokens.palette.edgeStrong : tokens.palette.edge,
    width: strong ? 1.8 : 1,
    opacity: view.dimmed ? tokens.search.dimOpacity : 1,
  });
}

/**
 * 验收辅助：检查一个绘制指令是否违反通道唯一语义。
 * 返回违规说明数组，空数组表示合规。
 */
export function findChannelViolations(paint: NodePaint): readonly string[] {
  const violations: string[] = [];
  if (paint.brightness < MIN_BRIGHTNESS || paint.brightness > 1) {
    violations.push('亮度越界：不应被搜索或其它通道改写');
  }
  if (paint.opacity < 0 || paint.opacity > 1) {
    violations.push('透明度越界');
  }
  if (paint.ring !== null && paint.marker !== null) {
    // 两个 DEC-01 通道允许叠加（不同视觉属性），此处只核对它们未占用亮度。
    const overlap = VISUAL_CHANNELS.filter(
      (channel) => channel.id === 'brightness' && channel.forbidden.includes('搜索匹配程度'),
    );
    if (overlap.length === 0) violations.push('通道注册表缺少亮度约束');
  }
  return Object.freeze(violations);
}
