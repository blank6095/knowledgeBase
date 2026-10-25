/**
 * 大模型接入（OpenAI 兼容 /chat/completions，raw fetch，零依赖）。
 *
 * Provider：DeepSeek（base URL 与默认模型为常量，换 provider 只改这两处）。
 * 配置来源：应用内设置页（app_settings 表，DB 优先）→ env LLM_* 回退。
 * API key 只在服务端流转，绝不进客户端 bundle、响应或日志。
 * 铁律：LLM 输出永远不直接写库，一律 preview → 用户确认 → apply 两步。
 *
 * 调用层纪律（docs/llm-optimization-plan.md L1）：
 * - 可观测：每次调用写 llm_calls（kind/model/token/耗时；不含 prompt）；
 * - 预算：max_tokens 默认 2048，输出超限抛可读错误；
 * - 重试：429/5xx/网络错误指数退避重试 1 次，其余 4xx 不重试；
 * - 护栏：进程内信号量并发 ≤3，超出排队；
 * - 分档：fast 档（摘要/测试）可用轻模型，未配置时与 default 同档。
 */
import { getLlmSettings } from '@/lib/app-settings';
import { logLlmCall } from '@/lib/llm-calls';

/** DeepSeek 官方 base url（OpenAI 兼容；文档 https://api-docs.deepseek.com） */
export const LLM_BASE_URL = 'https://api.deepseek.com';
/**
 * 默认模型 id（2026-10-25 实测：deepseek-v4-flash 真实调用成功；deepseek-chat 为官方稳定别名，
 * deepseek-reasoner 为推理系）。默认 id 以 DeepSeek 文档为准，仅改这一处。
 */
export const DEFAULT_MODEL = 'deepseek-v4-flash';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmConfig {
  apiKey: string;
  model: string;
  /** fast 档模型（未单独配置时等于 model） */
  fastModel: string;
}

export type LlmTier = 'fast' | 'default';

export interface ChatOptions {
  /** 调用点标识，写 llm_calls（ask / split / aggregate / import-split / summary / test） */
  kind: string;
  /** 输出 token 上限，默认 2048；拆解类建议 4096 */
  maxTokens?: number;
  /** 模型分档：fast 用于摘要/测试连接等轻任务 */
  tier?: LlmTier;
  temperature?: number;
  /** 429/5xx/网络错误的重试次数，默认 1 */
  retries?: number;
}

export interface ChatUsage {
  inTok: number;
  outTok: number;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
  model: string;
}

const TIMEOUT_MS = 60_000;
const MAX_CONCURRENT = 3;
const RETRY_BASE_MS = 1_500;

/** 未配置时给前端的指引（指向应用内设置页；不含任何密钥值） */
export const LLM_SETUP_HINT =
  '未配置大模型：请到侧边栏「设置」页填写 API Key（也可配置环境变量 DEEPSEEK_API_KEY，或 LLM_API_KEY + LLM_MODEL 后重启服务）。';
/** DB 读失败且无 env 回退时的指引（区分于「确实未配置」，避免把网络闪断误报成配置问题） */
export const LLM_DB_DOWN_HINT =
  '大模型设置读取失败（数据库暂时不可达）：请稍后重试，或在环境变量配置 DEEPSEEK_API_KEY 作为回退。';

export type LlmStatus =
  | { ok: true; config: LlmConfig }
  | { ok: false; reason: 'unconfigured' | 'db-down'; hint: string };

/**
 * 配置状态解析（L1-8）：DB 设置优先 → env 回退；
 * 显式区分「DB 读失败且无 env」（db-down）与「确实未配置」（unconfigured）。
 */
export async function resolveLlmStatus(): Promise<LlmStatus> {
  let dbSettings: Awaited<ReturnType<typeof getLlmSettings>> = null;
  let dbError = false;
  try {
    dbSettings = await getLlmSettings();
  } catch {
    dbError = true;
  }
  if (dbSettings?.apiKey && dbSettings.model) {
    return {
      ok: true,
      config: {
        apiKey: dbSettings.apiKey,
        model: dbSettings.model,
        fastModel: dbSettings.fastModel?.trim() || dbSettings.model,
      },
    };
  }
  if (process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return { ok: true, config: { apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, fastModel: process.env.LLM_MODEL } };
  }
  // 用户惯例命名：只给 key 时模型缺省 DEFAULT_MODEL（flash），可用 DEEPSEEK_MODEL 覆盖
  if (process.env.DEEPSEEK_API_KEY) {
    const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
    return { ok: true, config: { apiKey: process.env.DEEPSEEK_API_KEY, model, fastModel: model } };
  }
  if (dbError) return { ok: false, reason: 'db-down', hint: LLM_DB_DOWN_HINT };
  return { ok: false, reason: 'unconfigured', hint: LLM_SETUP_HINT };
}

/** 兼容入口：任何非 ok 状态返回 null（只需判断「是否可用」的场景用） */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  const s = await resolveLlmStatus();
  return s.ok ? s.config : null;
}

/** 按分档取模型（纯函数，供单测）：fast 档未配置/为空时回退主模型 */
export function pickModel(config: LlmConfig, tier: LlmTier = 'default'): string {
  const fast = config.fastModel?.trim();
  return tier === 'fast' && fast ? fast : config.model;
}

/** 是否应对该错误重试（纯函数，供单测）：网络类（无 status）/429/5xx 可重试，其余 4xx 不重试 */
export function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (typeof status !== 'number') return true; // 网络错误/超时/空返回
  return status === 429 || status >= 500;
}

// ---- 进程内并发护栏（≤3，超出排队） ----
let active = 0;
const waiters: Array<() => void> = [];
async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function releaseSlot(): void {
  active--;
  waiters.shift()?.();
}

interface UpstreamPayload {
  choices?: { message?: { content?: string }; finish_reason?: string; delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function requestOnce(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const reason =
      e instanceof Error && e.name === 'TimeoutError' ? `请求超时（${TIMEOUT_MS / 1000}s）` : `网络错误：${(e as Error).message}`;
    throw new Error(`大模型请求失败：${reason}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`大模型请求失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return res;
}

/**
 * 调用 chat/completions（非流式）：返回 {text, usage, model}；每次调用写 llm_calls。
 * 非条件重试不吞错误——重试耗尽后原样抛出，由调用方按「降级不阻断」铁律处理。
 */
export async function chatCompletion(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const status = await resolveLlmStatus();
  if (!status.ok) throw new Error(status.hint);
  const cfg = status.config;
  const model = pickModel(cfg, opts.tier);
  const maxTokens = opts.maxTokens ?? 2048;
  const temperature = opts.temperature ?? 0.2;
  const retries = opts.retries ?? 1;
  const started = Date.now();

  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    try {
      const res = await requestOnce(cfg.apiKey, model, messages, temperature, maxTokens);
      const data = (await res.json().catch(() => null)) as UpstreamPayload | null;
      if (data?.error?.message) throw new Error(`大模型返回错误：${data.error.message.slice(0, 200)}`);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('大模型返回为空或格式不符（缺少 choices[0].message.content）');
      }
      if (data?.choices?.[0]?.finish_reason === 'length') {
        throw new Error(`输出达到 max_tokens=${maxTokens} 上限被截断：请调小该段内容长度或降低输出预算后重试`);
      }
      const inTok = data?.usage?.prompt_tokens ?? 0;
      const outTok = data?.usage?.completion_tokens ?? 0;
      await logLlmCall({ kind: opts.kind, model, inTok, outTok, ms: Date.now() - started });
      return { text: content, usage: { inTok, outTok }, model };
    } catch (e) {
      const err = e as Error;
      if (attempt < retries && isRetryableError(err)) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
        continue;
      }
      await logLlmCall({ kind: opts.kind, model, ms: Date.now() - started, error: err.message });
      throw err;
    } finally {
      releaseSlot();
    }
  }
}

export interface StreamHandle {
  /** 已就绪（2xx）的上游流式响应体 */
  response: Response;
  model: string;
  /** 读取完毕或放弃后必须调用（释放并发槽） */
  release: () => void;
}

/**
 * 流式调用（L1-5）：resolve 配置 + 并发护栏 + 首次失败重试后，返回上游 SSE 响应。
 * usage 解析由调用方在末包完成（stream_options.include_usage）。
 * 仅在拿到 2xx 响应后才算成功；非 2xx 视同 requestOnce 错误参与重试。
 */
export async function chatCompletionStream(messages: ChatMessage[], opts: ChatOptions): Promise<StreamHandle> {
  const status = await resolveLlmStatus();
  if (!status.ok) throw new Error(status.hint);
  const cfg = status.config;
  const model = pickModel(cfg, opts.tier);
  const maxTokens = opts.maxTokens ?? 2048;
  const temperature = opts.temperature ?? 0.2;
  const retries = opts.retries ?? 1;

  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    let res: Response;
    try {
      try {
        res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const reason =
          e instanceof Error && e.name === 'TimeoutError' ? `请求超时（${TIMEOUT_MS / 1000}s）` : `网络错误：${(e as Error).message}`;
        throw new Error(`大模型请求失败：${reason}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`大模型请求失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
        (err as { status?: number }).status = res.status;
        throw err;
      }
      // 成功：并发槽交给调用方管理
      return { response: res, model, release: releaseSlot };
    } catch (e) {
      releaseSlot();
      const err = e as Error;
      if (attempt < retries && isRetryableError(err)) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
        continue;
      }
      await logLlmCall({ kind: opts.kind, model, error: err.message });
      throw err;
    }
  }
}

/**
 * 从 LLM 输出中提取 JSON：剥 ``` 围栏 → 截取首个 [ 或 { 到配对结尾（跳过字符串字面量）→ JSON.parse。
 * 失败抛可读错误（区分「没有 JSON」「括号不配对」「解析失败」）。
 */
export function extractJson<T = unknown>(output: string): T {
  let s = output.trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) s = fence[1].trim();

  const start = s.search(/[[{]/);
  if (start === -1) throw new Error('模型输出中没有找到 JSON（未出现 [ 或 {）');
  const open = s[start];
  const close = open === '[' ? ']' : '}';

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error('模型输出的 JSON 不完整（括号未配对）');

  try {
    return JSON.parse(s.slice(start, end)) as T;
  } catch (e) {
    throw new Error(`模型输出的 JSON 无法解析：${(e as Error).message.slice(0, 160)}`);
  }
}
