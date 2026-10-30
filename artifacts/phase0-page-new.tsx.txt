'use client';

/**
 * 关系图谱页入口（U0-1 拆分后只剩壳）。
 *
 * 容器组件 `KnowledgeUniverse` 负责业务数据、三层视图状态与页面级浮层；
 * 画布渲染见 `src/components/graph/GraphCanvas.tsx`，纯状态/纯逻辑见
 * `src/lib/graph/graph-state.ts`。
 */
import KnowledgeUniverse from '@/components/graph/KnowledgeUniverse';

export default function GraphPage() {
  return <KnowledgeUniverse />;
}
