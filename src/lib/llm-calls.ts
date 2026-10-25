/**
 * LLM 调用流水（llm_calls 表）：可观测层，每次真实调用与缓存命中各记一行。
 * 隐私铁律：只记维度与用量（kind/model/token/耗时/缓存/错误摘要），
 * 绝不记录 prompt 内容与画像文本。写入失败只打日志，绝不影响业务。
 */
import { db } from '@/db';
import { llmCalls } from '@/db/schema';

export interface LlmCallLogInput {
  kind: string;
  model: string;
  inTok?: number;
  outTok?: number;
  ms?: number;
  cached?: boolean;
  error?: string;
}

export async function logLlmCall(log: LlmCallLogInput): Promise<void> {
  try {
    await db.insert(llmCalls).values({
      kind: log.kind,
      model: log.model,
      inTok: log.inTok ?? 0,
      outTok: log.outTok ?? 0,
      ms: log.ms ?? 0,
      cached: log.cached ? 1 : 0,
      error: log.error ? log.error.slice(0, 200) : null,
    });
  } catch (e) {
    console.error('llm_calls 写入失败（已忽略）:', e instanceof Error ? e.message : e);
  }
}
