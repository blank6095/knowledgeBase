import { NextRequest, NextResponse } from 'next/server';
import { badRequest, guard } from '@/lib/api';
import { DEFAULT_MODEL, getLlmConfig } from '@/lib/llm';
import { getLlmSettings, saveLlmSettings } from '@/lib/app-settings';

/**
 * 保存 LLM 应用内配置（key='llm'）：
 * - apiKey 非空字符串 → 覆盖；留空/缺省 → 保留已存 key（GET 不回明文，故留空=不修改）；
 *   DB 无已存 key 且未提供时报错（env 回退形态也必须先在设置页落一个 key）。
 * - model 缺省 → DEFAULT_MODEL。
 * 响应不含明文 key。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown; model?: unknown };
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 100) : DEFAULT_MODEL;

  const existing = await getLlmSettings();
  let apiKey: string;
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    apiKey = body.apiKey.trim();
  } else if (existing?.apiKey) {
    apiKey = existing.apiKey;
  } else if (process.env.LLM_API_KEY) {
    // env 形态下留空保存 model：把 env key 固化进 DB，行为可预期
    apiKey = process.env.LLM_API_KEY;
  } else {
    return badRequest('API Key 不能为空：请输入 DeepSeek API Key');
  }

  await saveLlmSettings({ apiKey, model });
  const current = await getLlmConfig();
  return NextResponse.json({
    ok: true,
    model: current?.model ?? model,
    keyTail: current ? current.apiKey.slice(-4) : null,
  });
}

/** 设置页回显当前配置（model + keyTail），不回明文 */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const config = await getLlmConfig();
  return NextResponse.json({
    configured: Boolean(config),
    model: config?.model ?? DEFAULT_MODEL,
    keyTail: config ? config.apiKey.slice(-4) : null,
  });
}
