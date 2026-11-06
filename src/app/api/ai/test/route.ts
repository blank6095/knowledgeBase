import { NextRequest, NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { DEFAULT_MODEL, chatCompletion, resolveLlmStatus } from '@/lib/llm';

/**
 * 测试连接（UX-20）：支持携带**未保存的草稿配置**做一次真实连通性测试，不落库。
 *
 * 请求（均可选，字段名与 app_settings 的 llm 配置一致）：
 * - apiKey：草稿 Key；空/缺省 = 用已保存配置（绝不用空串覆盖已保存 Key）
 * - model：草稿主模型；空/缺省 = 用已保存主模型
 * - fastModel：草稿 fast 档模型（本接口按 fast 档测试）；空/缺省 = 用已保存 fast 档
 *
 * 响应（不出现完整 Key，只给掩码后 4 位）：
 * - 可用：{ ok: true, model, reply, keyMask, keySource: 'draft' | 'saved' }
 * - 不可用：{ ok: false, error, model?, keyMask, keySource }（仍为 200：测试结果就是业务结果）
 * - keySource 说明本次实际用哪把 Key 测试：draft=请求里的新 Key，saved=服务端已保存的 Key。
 * - 未配置任何 Key 时：{ ok: false, error, keyMask: null, keySource: null }
 *
 * 说明：base URL 是代码常量（LLM_BASE_URL），不接受请求传入——否则任意 URL 会成为 SSRF 入口。
 */
interface TestBody {
  apiKey?: unknown;
  model?: unknown;
  fastModel?: unknown;
}

/** 只接受字符串草稿值；空串/空白/非字符串一律视为「未传」 */
function draftString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** 掩码：只回显后 4 位；过短的 Key 一律只显示 **** */
function maskKey(apiKey: string): string {
  return apiKey.length >= 8 ? `****${apiKey.slice(-4)}` : '****';
}

/** 防御上游错误文本意外回显 Key：命中的明文替换成掩码 */
function redactKey(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join(maskKey(apiKey)) : message;
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as TestBody;
  const draftApiKey = draftString(body.apiKey, 500);
  const draftModel = draftString(body.model, 100);
  const draftFastModel = draftString(body.fastModel, 100);
  // 本次实际测哪把 Key：请求带新 Key 即 draft，否则用已保存的 saved
  const keySource = draftApiKey ? 'draft' : 'saved';

  // 已保存配置只作为缺省值；读不到（未配置/DB 不可达）时仍允许纯草稿测试
  const status = await resolveLlmStatus();
  const saved = status.ok ? status.config : null;
  const apiKey = draftApiKey || saved?.apiKey || '';
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: status.ok ? '未配置 API Key：请先粘贴 Key 再测试' : status.hint,
      keyMask: null,
      keySource: null,
    });
  }
  const model = draftModel || saved?.model || DEFAULT_MODEL;
  // 草稿只改主模型时，fast 档随之指向该模型，避免仍测到旧的已保存 fast 档
  const fastModel = draftFastModel || (draftModel ? draftModel : saved?.fastModel) || model;
  const keyMask = maskKey(apiKey);

  try {
    const result = await chatCompletion(
      [{ role: 'user', content: '请只回复两个字：连接成功' }],
      { kind: 'test', tier: 'fast', maxTokens: 50 },
      { apiKey, model, fastModel },
    );
    return NextResponse.json({
      ok: true,
      model: result.model,
      reply: result.text.slice(0, 100),
      keyMask,
      keySource,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: redactKey(e instanceof Error ? e.message : '连接失败', apiKey),
      model: fastModel,
      keyMask,
      keySource,
    });
  }
}
