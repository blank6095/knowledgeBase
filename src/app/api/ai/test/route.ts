import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { chatCompletion, getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';

/** 测试连接：服务端发一次最小 chat 请求，成功/失败都透出（错误含状态码与模型返回片段） */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const config = await getLlmConfig();
  if (!config) return NextResponse.json({ ok: false, error: LLM_SETUP_HINT }, { status: 503 });

  try {
    const reply = await chatCompletion([{ role: 'user', content: '请只回复两个字：连接成功' }]);
    return NextResponse.json({ ok: true, model: config.model, reply: reply.slice(0, 100) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '连接失败' });
  }
}
