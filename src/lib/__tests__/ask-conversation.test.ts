import { describe, expect, it } from 'vitest';
import {
  EMPTY_STREAM_MESSAGE,
  HISTORY_LIMIT,
  PARTIAL_STREAM_NOTE,
  appendTurn,
  buildConversationMessages,
  canApplyActions,
  isActionRetryable,
  pendingActionIndexes,
  resolveStreamFinish,
  retryableActionIndexes,
  type ConversationMessage,
} from '@/lib/ai/ask-conversation';

/** 模拟页面连续提问：每轮成功后追加到历史 */
function askRounds(questions: string[]): ConversationMessage[] {
  return questions.reduce<ConversationMessage[]>((history, question, index) => {
    return appendTurn(history, { question, answer: `回答${index + 1}` });
  }, []);
}

describe('ask-conversation / buildConversationMessages 多轮顺序（UX-06）', () => {
  it('连续 3 轮提问后，3 个用户问题与 3 条回答按顺序成对存在', () => {
    const history = askRounds(['问题1', '问题2', '问题3']);
    const messages = buildConversationMessages(history);
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages.map((message) => message.content)).toEqual([
      '问题1',
      '回答1',
      '问题2',
      '回答2',
      '问题3',
      '回答3',
    ]);
  });

  it('当前流式回答追加在历史之后，并标记 streaming（旧回答不被覆盖）', () => {
    const history = askRounds(['上一问']);
    const messages = buildConversationMessages(history, {
      question: '这一问',
      answer: '这一答的前半段',
      streaming: true,
    });
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'user', content: '上一问' });
    expect(messages[1]).toEqual({ role: 'assistant', content: '回答1' });
    expect(messages[2]).toEqual({ role: 'user', content: '这一问' });
    expect(messages[3]).toMatchObject({ role: 'assistant', content: '这一答的前半段', streaming: true });
  });

  it('首个 delta 到达前保留用户问题，并给出一条 loading 占位消息', () => {
    const messages = buildConversationMessages([], { question: '新问题', answer: '', streaming: true });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: '新问题' });
    expect(messages[1]).toEqual({ role: 'assistant', content: '', streaming: true });
  });

  it('失败的一轮（无内容且已停止流式）只渲染用户问题，不产生空白回答气泡', () => {
    const messages = buildConversationMessages([], { question: '失败的问题', answer: '' });
    expect(messages).toEqual([{ role: 'user', content: '失败的问题' }]);
  });

  it('历史中的来源随助手消息保留，供回看', () => {
    const history = appendTurn([], {
      question: '带来源的问题',
      answer: '带来源的回答',
      sources: [{ segmentId: 'seg-1', title: 'TCP 与 UDP' }],
    });
    const messages = buildConversationMessages(history);
    expect(messages[1].sources).toEqual([{ segmentId: 'seg-1', title: 'TCP 与 UDP' }]);
  });

  it('不修改传入的 history，且每次返回新数组', () => {
    const history = askRounds(['问题1']);
    const snapshot = JSON.stringify(history);
    const messages = buildConversationMessages(history, { question: '问题2', answer: '回答2' });
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(messages).not.toBe(history);
    expect(messages).toHaveLength(4);
  });

  it('空历史且没有当前轮时返回空列表', () => {
    expect(buildConversationMessages([])).toEqual([]);
    expect(buildConversationMessages([], null)).toEqual([]);
  });
});

describe('ask-conversation / appendTurn 历史上限', () => {
  it('超过 HISTORY_LIMIT 时从头截断，且保持 user/assistant 成对顺序', () => {
    const history = askRounds(Array.from({ length: 8 }, (_, index) => `问题${index + 1}`));
    expect(history).toHaveLength(HISTORY_LIMIT);
    // 8 轮 = 16 条消息，保留最后 10 条：从第 4 轮的问题开始
    expect(history[0]).toEqual({ role: 'user', content: '问题4' });
    expect(history[1]).toEqual({ role: 'assistant', content: '回答4' });
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: '回答8' });
  });
});

describe('ask-conversation / resolveStreamFinish 空流收尾（UX-07）', () => {
  it('无 done 且无任何 delta → empty（页面进入错误态，输入内容保留）', () => {
    expect(resolveStreamFinish({ done: false, answer: '' })).toBe('empty');
    expect(resolveStreamFinish({ done: false, answer: '   \n\t ' })).toBe('empty');
    expect(EMPTY_STREAM_MESSAGE).toContain('请重试');
  });

  it('有 done 且内容为空 → empty（不把空回答当成完整回答）', () => {
    expect(resolveStreamFinish({ done: true, answer: '' })).toBe('empty');
  });

  it('有内容且收到 done → done', () => {
    expect(resolveStreamFinish({ done: true, answer: '完整回答' })).toBe('done');
  });

  it('有内容但没有 done → partial（提示回答可能不完整）', () => {
    expect(resolveStreamFinish({ done: false, answer: '半截回答' })).toBe('partial');
    expect(PARTIAL_STREAM_NOTE).toContain('不完整');
  });
});

describe('ask-conversation / 改动确认卡重试判定（UX-09）', () => {
  it('只有 error 项可单条重试；pending 走应用、applied 不重复写库', () => {
    expect(isActionRetryable({ status: 'error' })).toBe(true);
    expect(isActionRetryable({ status: 'pending' })).toBe(false);
    expect(isActionRetryable({ status: 'applied' })).toBe(false);
  });

  it('全部失败后「应用」按钮仍可见（error 也算可执行操作）', () => {
    expect(canApplyActions([{ status: 'error' }, { status: 'error' }])).toBe(true);
    expect(canApplyActions([{ status: 'applied' }, { status: 'error' }])).toBe(true);
    expect(canApplyActions([{ status: 'pending' }])).toBe(true);
    expect(canApplyActions([{ status: 'applied' }, { status: 'applied' }])).toBe(false);
    expect(canApplyActions([])).toBe(false);
  });

  it('主按钮默认只取 pending；单条重试只取 error 索引', () => {
    const actions = [{ status: 'applied' }, { status: 'pending' }, { status: 'error' }, { status: 'error' }] as const;
    expect(pendingActionIndexes(actions)).toEqual([1]);
    expect(retryableActionIndexes(actions)).toEqual([2, 3]);
  });

  it('没有 pending 但有 error 时，主按钮目标退化为全部失败项（不永久消失）', () => {
    const actions = [{ status: 'applied' }, { status: 'error' }] as const;
    expect(pendingActionIndexes(actions)).toEqual([]);
    expect(retryableActionIndexes(actions)).toEqual([1]);
    expect(canApplyActions(actions)).toBe(true);
  });
});
