/** 知识宇宙内核公共入口：仅导出稳定 API，不导出内部实现细节。 */

export {
  VISUAL_CHANNELS,
  DEFAULT_PALETTE,
  createTokens,
  decisionGatedChannels,
  type ChannelId,
  type DecisionChannelPolicy,
  type UniversePalette,
  type UniverseTokens,
  type UniverseTokensInput,
  type BackgroundId,
  type LineStyleId,
  type NodeStyleId,
  type VisualChannelSpec,
} from './tokens';

export {
  MAIN_MODES,
  createInitialState,
  reduceUniverseState,
  isConsistentState,
  type MainMode,
  type OverlayId,
  type UniverseAction,
  type UniverseContext,
  type UniverseState,
  type ViewportSnapshot,
} from './state';

export {
  normalizeMemory,
  createVisualFacts,
  indexTodayLearning,
  type GraphNodeRecord,
  type NodeFacts,
  type TodayLearningRecord,
  type LearningReasonCode,
  type RecallResult,
} from './data';

export {
  encodeBrightness,
  encodeSearchOpacity,
  encodeNode,
  encodeEdge,
  findChannelViolations,
  type NodePaint,
  type NodeViewContext,
  type EdgePaint,
  type EdgeViewContext,
} from './visual';

export {
  SpatialHash,
  type IndexedNode,
  type Rect,
  type SpatialPoint,
} from './spatial-index';

export {
  buildDrawList,
  paintDrawList,
  type DrawCommand,
  type DrawList,
  type SceneEdge,
  type SceneNode,
  type UniverseScene,
  type Viewport,
} from './renderer';

export {
  createUniverseEngine,
  type UniverseEdgeInput,
  type UniverseEngine,
  type UniverseEngineOptions,
  type UniverseNodeInput,
} from './engine';
