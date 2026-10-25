import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { chatCompletion, resolveLlmStatus } from '@/lib/llm';

/** 测试连接：服务端发一次最小 chat 请求（fast 档、最小预算），成功/失败都透出（错误含状态码与模型返回片段） */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const status = await resolveLlmStatus();
  if (!status.ok) return NextResponse.json({ ok: false, error: status.hint }, { status: 503 });

  try {
    const result = await chatCompletion([{ role: 'user', content: '请只回复两个字：连接成功' }], {
      kind: 'test',
      tier: 'fast',
      maxTokens: 50,
    });
    return NextResponse.json({ ok: true, model: result.model, reply: result.text.slice(0, 100) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '连接失败' });
  }
}
