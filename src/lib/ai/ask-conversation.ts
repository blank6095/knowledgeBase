/**
 * /ask 多轮对话的纯逻辑：消息列表拼装、流式收尾判定、改动确认卡的可重试判定。
 *
 * 抽成纯函数的原因（UX-06 / UX-07 / UX-09）：
 * - 页面此前只有一个 `result` state，每次提问先 setResult(null)，用户提问与历史从不渲染；
 * - SSE 在首个 delta 前中断时没有收尾分支，页面停在空回答且输入框被清空；
 * - 改动项失败后 status='error'，而重试只跑 status==='pending'，全部失败后按钮消失。
 * 这些判定放在 React 状态机里无法单测，因此集中到本模块；页面只负责 setState 与渲染。
 *
 * 不依赖 React / Next / fetch / DOM，服务端与客户端均可安全 import。
 */

/** 历史条数上限：与 `/api/ai/ask` 服务端的 HISTORY_LIMIT 保持一致（10 条 = 5 轮） */
export const HISTORY_LIMIT = 10;

/** 空流收尾的固定文案：既用于页面错误态，也用于单测断言 */
export const EMPTY_STREAM_MESSAGE = '没有收到回答内容：连接可能在开始输出前中断，请重试。';

/** 有内容但没有 done 事件时的提示（连接提前结束，回答可能被截断） */
export const PARTIAL_STREAM_NOTE = '连接提前结束，这条回答可能不完整；需要完整回答可重试。';

/** 改动确认卡单项的应用状态 */
export type ActionStatus = 'pending' | 'applied' | 'error';

/** 助手回答引用的知识点（与 `/api/ai/ask` done 事件里的 sources 同形） */
export interface ConversationSource {
  segmentId: string;
  title: string;
}

/** 消息列表中的一条：页面只按 role 渲染，不再区分「历史」与「当前」 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 仅助手消息：该轮引用来源；历史轮次也保留，便于回看 */
  sources?: ConversationSource[];
  /** 仅最后一条助手消息：正在流式生成，渲染光标/加载态 */
  streaming?: boolean;
}

/** 当前这一轮（流式中或刚失败）：问题 + 已累积回答 */
export interface ConversationTurn {
  question: string;
  answer: string;
  sources?: ConversationSource[];
  streaming?: boolean;
}

export interface StreamFinishInput {
  /** 是否收到 done 事件 */
  done: boolean;
  /** 已累积的回答内容（流式过程中可能为空或只有空白） */
  answer: string;
}

/** 流式收尾结果：完整 / 部分 / 空 */
export type StreamFinish = 'done' | 'partial' | 'empty';

/** 改动项的可重试判定只关心 status 字段，避免本模块依赖页面里的 action 类型 */
export interface ActionStatusLike {
  status: ActionStatus;
}

/**
 * 把已完成的 history 与「当前这一轮」拼成渲染用消息列表。
 *
 * - history 按原顺序保留（appendTurn 保证 user/assistant 成对），来源随消息保留；
 * - 当前轮先追加用户问题，再追加助手回答；首个 delta 到达前回答为空，但仍追加一条
 *   `streaming: true` 的占位消息，让页面渲染加载态而不是空白；
 * - 当前轮没有问题时（理论上不会发生）不加任何消息；
 * - 不修改入参，返回新数组。
 */
export function buildConversationMessages(
  history: readonly ConversationMessage[],
  turn?: ConversationTurn | null,
): ConversationMessage[] {
  const messages: ConversationMessage[] = history.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.sources && message.sources.length > 0 ? { sources: message.sources } : {}),
    ...(message.streaming ? { streaming: true } : {}),
  }));
  if (!turn) return messages;

  const question = turn.question.trim();
  if (!question) return messages;
  messages.push({ role: 'user', content: question });

  if (turn.answer.length > 0 || turn.streaming) {
    messages.push({
      role: 'assistant',
      content: turn.answer,
      ...(turn.sources && turn.sources.length > 0 ? { sources: turn.sources } : {}),
      ...(turn.streaming ? { streaming: true } : {}),
    });
  }
  return messages;
}

/**
 * 一轮问答成功后写入历史：成对追加 user/assistant，并按 HISTORY_LIMIT 截断。
 * 截断按「消息条数」进行；由于历史始终由本函数成对追加，10 条 = 5 轮，不会把一轮拆开。
 */
export function appendTurn(
  history: readonly ConversationMessage[],
  turn: ConversationTurn,
): ConversationMessage[] {
  const messages = buildConversationMessages(history, { ...turn, streaming: false });
  return messages.slice(-HISTORY_LIMIT);
}

/**
 * 流式收尾判定（UX-07）：
 * - 有任何内容且收到 done → 'done'：正常完整回答；
 * - 有内容但没有 done → 'partial'：连接提前结束，内容可用但要提示可能不完整；
 * - 完全没有任何内容（无论有没有 done）→ 'empty'：页面进入错误态并保留输入内容，
 *   不再停在 `{answer:'', streaming:true}`。
 */
export function resolveStreamFinish(input: StreamFinishInput): StreamFinish {
  if (input.answer.trim().length === 0) return 'empty';
  return input.done ? 'done' : 'partial';
}

/** 单条重试只针对 error：pending 走「应用」，applied 不重复写库（UX-09） */
export function isActionRetryable(action: ActionStatusLike): boolean {
  return action.status === 'error';
}

/** 「应用」按钮的可见性：还有 pending 或 error 项时按钮都不应消失（UX-09） */
export function canApplyActions(actions: readonly ActionStatusLike[]): boolean {
  return actions.some((action) => action.status === 'pending' || action.status === 'error');
}

/** 主按钮默认只应用 pending 项；全部失败时返回空数组，由页面改用 retryableActionIndexes */
export function pendingActionIndexes(actions: readonly ActionStatusLike[]): number[] {
  return actions.reduce<number[]>((indexes, action, index) => {
    return action.status === 'pending' ? [...indexes, index] : indexes;
  }, []);
}

/** 可单条重试的索引（error 项）；按原顺序返回 */
export function retryableActionIndexes(actions: readonly ActionStatusLike[]): number[] {
  return actions.reduce<number[]>((indexes, action, index) => {
    return isActionRetryable(action) ? [...indexes, index] : indexes;
  }, []);
}
