/**
 * 知识库助手 Agent 的工具集（OpenAI tools 格式）与纯函数工具：
 * - AGENT_TOOLS：下发给模型的三件套（search/read/propose）；
 * - mergeToolCallDelta：流式 tool_call 分片组装（按 index 聚合 id/name/arguments）；
 * - validateActions：propose_actions 提议的形状校验与归一（服务端零执行，前端确认后才走 v10 端点）。
 */

export interface ToolCallRef {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: '在知识库中检索知识点。返回 segmentId/标题/摘要/记忆度。回答需要库内具体细节时先调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          top_k: { type: 'integer', description: '返回条数，默认 6，最大 8' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_segment',
      description: '读取一个知识点的全文（含标题/标签/记忆状态）。只知道 segmentId 时用它拿细节。',
      parameters: {
        type: 'object',
        properties: { segmentId: { type: 'string', description: '知识点 id（来自 search_knowledge）' } },
        required: ['segmentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_actions',
      description:
        '管理类操作的提议（改标题/内容/标签、删除知识点、插入知识点、改文档信息）。只提议不执行，系统会生成确认卡交用户逐项确认。segmentId/documentId 必须来自检索结果，不得虚构。',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: '动作列表',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['update_segment', 'delete_segment', 'create_segment', 'update_document'] },
                segmentId: { type: 'string' },
                documentId: { type: 'string' },
                afterIndex: { type: 'integer' },
                title: { type: 'string' },
                content: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        required: ['actions'],
      },
    },
  },
] as const;

/** 流式分片累积状态：index → 已组装的 tool_call */
export interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

/**
 * 把上游 delta.tool_calls 分片并入累积表（就地修改）。
 * 分片形如 {index, id?, function?: {name?, arguments?}}：id/name 只在首片出现，arguments 逐片追加。
 */
export function mergeToolCallDelta(
  acc: Map<number, ToolCallAcc>,
  delta: { index?: number; id?: string; function?: { name?: string; arguments?: string } },
): void {
  if (typeof delta.index !== 'number') return;
  const idx = delta.index;
  const cur = acc.get(idx) ?? { id: '', name: '', args: '' };
  if (delta.id) cur.id = delta.id;
  if (delta.function?.name) cur.name = delta.function.name;
  if (delta.function?.arguments) cur.args += delta.function.arguments;
  acc.set(idx, cur);
}

export type AgentAction =
  | { type: 'update_segment'; segmentId: string; title?: string; content?: string; tags?: string[] }
  | { type: 'delete_segment'; segmentId: string }
  | { type: 'create_segment'; documentId: string; afterIndex?: number; title: string; content: string }
  | { type: 'update_document'; documentId: string; title?: string; tags?: string[] };

const ACTION_TYPES = new Set(['update_segment', 'delete_segment', 'create_segment', 'update_document']);
const MAX_ACTIONS = 10;

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{10,}$/i.test(v.trim());
const strOpt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * 校验并归一 propose_actions 的原始输出。
 * 返回 {actions, errors}：合法项归一后保留；非法项以可读错误回喂模型（不中断）。
 */
export function validateActions(raw: unknown): { actions: AgentAction[]; errors: string[] } {
  const actions: AgentAction[] = [];
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { actions, errors: ['actions 必须是数组'] };

  for (const [i, item] of raw.slice(0, MAX_ACTIONS).entries()) {
    const bad = (msg: string) => errors.push(`第 ${i + 1} 项：${msg}`);
    if (!item || typeof item !== 'object') {
      bad('不是对象');
      continue;
    }
    const o = item as Record<string, unknown>;
    const type = String(o.type ?? '');
    if (!ACTION_TYPES.has(type)) {
      bad(`未知动作类型 ${type || '(空)'}`);
      continue;
    }
    const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()).slice(0, 20) : undefined;

    if (type === 'update_segment') {
      const segmentId = o.segmentId;
      if (!isId(segmentId)) { bad('segmentId 无效'); continue; }
      const title = strOpt(o.title);
      const content = typeof o.content === 'string' && o.content.trim() ? o.content : undefined;
      if (!title && !content && !tags?.length) { bad('至少提供 title/content/tags 之一'); continue; }
      const a: AgentAction = { type: 'update_segment', segmentId: segmentId!.trim() };
      if (title) a.title = title.slice(0, 200);
      if (content) a.content = content;
      if (tags?.length) a.tags = tags;
      actions.push(a);
    } else if (type === 'delete_segment') {
      if (!isId(o.segmentId)) { bad('segmentId 无效'); continue; }
      actions.push({ type: 'delete_segment', segmentId: String(o.segmentId).trim() });
    } else if (type === 'create_segment') {
      if (!isId(o.documentId)) { bad('documentId 无效'); continue; }
      const title = strOpt(o.title);
      const content = typeof o.content === 'string' && o.content.trim() ? o.content : undefined;
      if (!title || !content) { bad('create_segment 需要 title 与 content'); continue; }
      const a: AgentAction = { type: 'create_segment', documentId: String(o.documentId).trim(), title: title.slice(0, 200), content };
      if (typeof o.afterIndex === 'number' && Number.isInteger(o.afterIndex) && o.afterIndex >= 0) a.afterIndex = o.afterIndex;
      actions.push(a);
    } else {
      // update_document
      if (!isId(o.documentId)) { bad('documentId 无效'); continue; }
      const title = strOpt(o.title);
      if (!title && !tags?.length) { bad('至少提供 title 或 tags'); continue; }
      const a: AgentAction = { type: 'update_document', documentId: String(o.documentId).trim() };
      if (title) a.title = title.slice(0, 300);
      if (tags?.length) a.tags = tags;
      actions.push(a);
    }
  }
  return { actions, errors };
}
