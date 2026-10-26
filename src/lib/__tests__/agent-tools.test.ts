import { describe, expect, it } from 'vitest';
import { mergeToolCallDelta, validateActions, type ToolCallAcc } from '../agent-tools';

describe('mergeToolCallDelta 流式 tool_call 组装', () => {
  it('id/name 首片出现、arguments 逐片追加', () => {
    const acc = new Map<number, ToolCallAcc>();
    mergeToolCallDelta(acc, { index: 0, id: 'call_1', function: { name: 'search_knowledge', arguments: '{"que' } });
    mergeToolCallDelta(acc, { index: 0, function: { arguments: 'ry":"网络"}' } });
    const c = acc.get(0)!;
    expect(c.id).toBe('call_1');
    expect(c.name).toBe('search_knowledge');
    expect(c.args).toBe('{"query":"网络"}');
  });

  it('多工具并行按 index 独立组装', () => {
    const acc = new Map<number, ToolCallAcc>();
    mergeToolCallDelta(acc, { index: 0, id: 'a', function: { name: 'read_segment', arguments: '{"seg' } });
    mergeToolCallDelta(acc, { index: 1, id: 'b', function: { name: 'propose_actions', arguments: '{"ac' } });
    mergeToolCallDelta(acc, { index: 0, function: { arguments: 'mentId":"x"}' } });
    mergeToolCallDelta(acc, { index: 1, function: { arguments: 'tions":[]}' } });
    expect(acc.get(0)!.args).toBe('{"segmentId":"x"}');
    expect(acc.get(1)!.name).toBe('propose_actions');
    expect(acc.size).toBe(2);
  });

  it('缺 index 的分片被忽略', () => {
    const acc = new Map<number, ToolCallAcc>();
    mergeToolCallDelta(acc, { id: 'x', function: { name: 'n' } });
    expect(acc.size).toBe(0);
  });
});

describe('validateActions 提议校验', () => {
  it('四类动作合法输入全部归一', () => {
    const { actions, errors } = validateActions([
      { type: 'update_segment', segmentId: ' 5d8bd6f2-aa65-4a7b-b188-7dabcbb6ec6b ', title: '新标题' },
      { type: 'delete_segment', segmentId: '5d8bd6f2-aa65-4a7b-b188-7dabcbb6ec6b' },
      { type: 'create_segment', documentId: '258c90af-dc62-40a2-b366-71a5d7b2de64', afterIndex: 2, title: '插入段', content: '内容' },
      { type: 'update_document', documentId: '258c90af-dc62-40a2-b366-71a5d7b2de64', tags: ['网络', ' 基础 ', ''] },
    ]);
    expect(errors).toEqual([]);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toEqual({ type: 'update_segment', segmentId: '5d8bd6f2-aa65-4a7b-b188-7dabcbb6ec6b', title: '新标题' });
    expect(actions[3]).toMatchObject({ type: 'update_document', tags: ['网络', '基础'] });
  });

  it('未知类型 / 缺 id / 空更新被拒并有可读错误', () => {
    const { actions, errors } = validateActions([
      { type: 'drop_database', segmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      { type: 'delete_segment', segmentId: '不是id' },
      { type: 'update_segment', segmentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    ]);
    expect(actions).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('未知动作类型');
    expect(errors[1]).toContain('segmentId 无效');
    expect(errors[2]).toContain('至少提供');
  });

  it('create_segment 缺 title/content 被拒', () => {
    const { actions, errors } = validateActions([{ type: 'create_segment', documentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: '只有标题' }]);
    expect(actions).toHaveLength(0);
    expect(errors[0]).toContain('title 与 content');
  });

  it('非数组输入返回单条错误', () => {
    expect(validateActions(null).errors).toEqual(['actions 必须是数组']);
    expect(validateActions('x').actions).toEqual([]);
  });
});
