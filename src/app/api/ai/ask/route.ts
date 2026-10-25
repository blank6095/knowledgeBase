import { NextRequest, NextResponse } from 'next/server';
import { badRequest, guard } from '@/lib/api';
import { chatCompletion, getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';
import { retrieveByQuery } from '@/lib/rag';

/**
 * 问知识库：retrieveByQuery(top 6) 取材料 → 约束式 prompt（仅基于材料、不足直说、不得编造）
 * → {answer, sources}。sources 为命中的知识节点（前端跳转 /segments/[id]）。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  if (!(await getLlmConfig())) {
    return NextResponse.json({ error: LLM_SETUP_HINT }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
  if (!query) return badRequest('请输入问题');

  const materials = await retrieveByQuery(query, 6);

  // 库内无相关内容：不调用模型，直接明确告知（杜绝编造）
  if (materials.length === 0) {
    return NextResponse.json({
      answer: '知识库中没有找到与这个问题相关的内容，暂时无法回答。可以先在「知识库」导入相关笔记，或换个问法再试。',
      sources: [],
    });
  }

  const context = materials
    .map((m, i) => `【材料 ${i + 1}】《${m.title}》\n${m.snippet}`)
    .join('\n\n');
  const system = [
    '你是个人知识库「暗夜书房」的问答助手。回答规则：',
    '1. 仅基于下面给定的知识库材料回答，不得使用材料之外的知识，不得编造；',
    '2. 材料不足以完整回答问题时，明确说明材料中只有哪些相关信息、缺什么，不要强行下结论；',
    '3. 用 Markdown 简洁作答（可列表），语气与知识库一致；引用了某段材料可在句末标注（来源 n）。',
    '',
    '知识库材料：',
    context,
  ].join('\n');

  const answer = await chatCompletion([
    { role: 'system', content: system },
    { role: 'user', content: query },
  ]);

  return NextResponse.json({
    answer,
    sources: materials.map((m) => ({ segmentId: m.segmentId, title: m.title })),
  });
}
