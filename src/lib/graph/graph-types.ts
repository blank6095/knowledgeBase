/**
 * 图谱业务数据契约（U0-1 / U0-2 共用）。
 *
 * 同一份 `GraphNode` 同时服务两个数据源：
 * - `GET /api/graph`：由 U0-2 扩展出 tags / summary / headingPath（真实 DB 字段）；
 * - `public/fixtures/*.json`：压测数据生成器产物，历史文件只含基础字段，
 *   因此三个扩展字段声明为可选，UI 侧按“可能缺失”处理。
 *
 * 约束：字段只增不删（U0-2 向后兼容）；`memory` 为读取时现算的记忆度 [0,1]。
 */
export interface GraphNode {
  id: string;
  title: string;
  memory: number;
  viewCount: number;
  readingMs: number;
  documentTitle: string | null;
  /** 知识点标签（fixture 数据可能缺失） */
  tags?: string[];
  /** 30 字 LLM 摘要，可能为 null（fixture 数据可能缺失） */
  summary?: string | null;
  /** 文档内标题路径，如 "基础篇 > 索引原理"（fixture 数据可能缺失） */
  headingPath?: string;
}

/** force-graph 会把 source/target 原地替换为节点对象，故两种形态都要接受。 */
export interface GraphLink {
  source: string | { id: string };
  target: string | { id: string };
  kind: string;
  weight: number;
}

/** `/api/graph` 与 `/fixtures/*.json` 的响应同构。 */
export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphLink[];
}
