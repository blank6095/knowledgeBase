import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { getLlmConfig } from '@/lib/llm';
import { getLearnerDeclaration } from '@/lib/learner-profile';

/**
 * 前端探测 LLM 可用性：DB 配置优先、env 回退。
 * 响应 {configured, model, fastModel, keyTail, learnerDeclaration}——keyTail 为 key 尾 4 位（保存后核对用），任何接口不回明文 key。
 */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const config = await getLlmConfig();
  return NextResponse.json({
    configured: Boolean(config),
    model: config?.model ?? null,
    fastModel: config ? config.fastModel : null,
    keyTail: config ? config.apiKey.slice(-4) : null,
    learnerDeclaration: await getLearnerDeclaration().catch(() => ''),
  });
}
