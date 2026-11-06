import { NextRequest, NextResponse } from 'next/server';
import { badRequest, guard } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { DEFAULT_MODEL, getLlmConfig } from '@/lib/llm';
import { getLearnerDeclaration, saveLearnerDeclaration } from '@/lib/learner-profile';
import { getLlmSettings, getLlmKeyState, saveLlmSettings } from '@/lib/app-settings';

/**
 * 保存设置：LLM 配置（key='llm'）+ 学习者自述声明（key='learner'）。
 *
 * PATCH 语义：请求体里**没带的字段一律不写**，避免"读取失败时保存"把已存配置重置：
 * - apiKey 传了且非空 → 覆盖；留空/不传 → 保留已存 key（GET 不回明文，故留空=不修改）；
 * - model 传了 → 覆盖；不传 → 沿用已存 model（无历史配置时才回落 DEFAULT_MODEL）；
 * - fastModel 传了 → 覆盖（空串=清除，同主模型）；不传 → 沿用已存 fast 档；
 * - learnerDeclaration 传了 → 覆盖自述（空串=清除）；不传 → 不动已存自述。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: unknown;
    model?: unknown;
    fastModel?: unknown;
    learnerDeclaration?: unknown;
  };

  const existing = await getLlmSettings();
  let apiKey: string;
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    apiKey = body.apiKey.trim();
  } else if (existing?.apiKey) {
    apiKey = existing.apiKey;
  } else if (process.env.LLM_API_KEY) {
    // env 形态下留空保存 model：把 env key 固化进 DB，行为可预期
    apiKey = process.env.LLM_API_KEY;
  } else if (process.env.DEEPSEEK_API_KEY) {
    apiKey = process.env.DEEPSEEK_API_KEY;
  } else {
    return badRequest('API Key 不能为空：请输入 DeepSeek API Key');
  }

  const model =
    typeof body.model === 'string' && body.model.trim()
      ? body.model.trim().slice(0, 100)
      : (existing?.model ?? DEFAULT_MODEL);
  const fastModel =
    typeof body.fastModel === 'string'
      ? body.fastModel.trim().slice(0, 100)
      : (existing?.fastModel ?? '');

  await saveLlmSettings({ apiKey, model, fastModel: fastModel || undefined });

  if (typeof body.learnerDeclaration === 'string') {
    await saveLearnerDeclaration(body.learnerDeclaration.slice(0, 500));
  }

  // 设置已落库：探测接口缓存必须失效，保证保存后立即回显新配置
  invalidateCache('ai-config');

  const current = await getLlmConfig();
  const declaration = await getLearnerDeclaration();
  return NextResponse.json({
    ok: true,
    model: current?.model ?? model,
    fastModel: current?.fastModel ?? '',
    keyTail: current ? current.apiKey.slice(-4) : null,
    learnerDeclaration: declaration,
  });
}

/** 设置页回显当前配置（model + fastModel + keyTail + 学习者自述），不回明文 */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const [config, keyState] = await Promise.all([getLlmConfig(), getLlmKeyState()]);
  return NextResponse.json({
    configured: Boolean(config),
    model: config?.model ?? DEFAULT_MODEL,
    fastModel: config ? (config.fastModel === config.model ? '' : config.fastModel) : '',
    keyTail: config ? config.apiKey.slice(-4) : null,
    learnerDeclaration: await getLearnerDeclaration(),
    keyState,
  });
}
