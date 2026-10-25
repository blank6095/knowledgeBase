/**
 * 大模型接入（OpenAI 兼容 /chat/completions，raw fetch，零依赖）。
 *
 * Provider：DeepSeek（base URL 与默认模型为常量，换 provider 只改这两处）。
 * 配置来源：应用内设置页（app_settings 表，DB 优先）→ env LLM_* 回退。
 * API key 只在服务端流转，绝不进客户端 bundle、响应或日志。
 * 铁律：LLM 输出永远不直接写库，一律 preview → 用户确认 → apply 两步。
 */
import { getLlmSettings } from '@/lib/app-settings';

/** DeepSeek 官方 base url（OpenAI 兼容；文档 https://api-docs.deepseek.com） */
export const LLM_BASE_URL = 'https://api.deepseek.com';
/** DeepSeek 官方模型 id：deepseek-chat（指向 V3 系列，id 随官方升级稳定）。默认 id 以 DeepSeek 文档为准，仅改这一处 */
export const DEFAULT_MODEL = 'deepseek-chat';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmConfig {
  apiKey: string;
  model: string;
}

const TIMEOUT_MS = 60_000;

/** 未配置时给前端的指引（指向应用内设置页；不含任何密钥值） */
export const LLM_SETUP_HINT = '未配置大模型：请到侧边栏「设置」页填写 API Key（也可用环境变量 LLM_API_KEY / LLM_MODEL 配置后重启）。';

/**
 * 配置解析：应用内设置（DB）优先 → env LLM_* 回退；均未配置返回 null。
 * DB 读取失败时静默回退 env，保证设置表异常不阻断 env 部署形态。
 */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  try {
    const s = await getLlmSettings();
    if (s?.apiKey && s.model) return { apiKey: s.apiKey, model: s.model };
  } catch {
    // fall through to env
  }
  if (process.env.LLM_API_KEY && process.env.LLM_MODEL) {
    return { apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  }
  return null;
}

/** 调用 chat/completions 返回首条消息文本；非 2xx 抛含状态码与响应片段的错误 */
export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const config = await getLlmConfig();
  if (!config) throw new Error(LLM_SETUP_HINT);
  let res: Response;
  try {
    res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const reason =
      e instanceof Error && e.name === 'TimeoutError' ? `请求超时（${TIMEOUT_MS / 1000}s）` : `网络错误：${(e as Error).message}`;
    throw new Error(`大模型请求失败：${reason}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`大模型请求失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('大模型返回为空或格式不符（缺少 choices[0].message.content）');
  }
  return content;
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
