import { NextRequest, NextResponse } from 'next/server';
import { badRequest, guard } from '@/lib/api';
import { invalidateCache } from '@/lib/cache';
import { DEFAULT_MODEL, getLlmConfig } from '@/lib/llm';
import { getLearnerDeclaration, saveLearnerDeclaration } from '@/lib/learner-profile';
import { getLlmSettings, saveLlmSettings } from '@/lib/app-settings';

/**
 * 保存设置：LLM 配置（key='llm'）+ 学习者自述声明（key='learner'）。
 * - apiKey 非空 → 覆盖；留空 → 保留已存 key（GET 不回明文，故留空=不修改）；
 * - model 缺省 → DEFAULT_MODEL；
 * - fastModel 可选（摘要/测试连接等轻任务的 fast 档），空串 → 清除（同主模型）；
 * - learnerDeclaration 存在 → 覆盖自述（空串=清除）。
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
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 100) : DEFAULT_MODEL;
  const fastModel = typeof body.fastModel === 'string' ? body.fastModel.trim().slice(0, 100) : '';

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
  const config = await getLlmConfig();
  return NextResponse.json({
    configured: Boolean(config),
    model: config?.model ?? DEFAULT_MODEL,
    fastModel: config ? (config.fastModel === config.model ? '' : config.fastModel) : '',
    keyTail: config ? config.apiKey.slice(-4) : null,
    learnerDeclaration: await getLearnerDeclaration(),
  });
}
