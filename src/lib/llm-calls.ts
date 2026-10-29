/**
 * LLM 调用流水（llm_calls 表）：可观测层，每次真实调用与缓存命中各记一行。
 * 隐私铁律：只记维度与用量（kind/model/token/耗时/缓存/错误摘要），
 * 绝不记录 prompt 内容与画像文本。写入失败只打日志，绝不影响业务。
 */
import { db } from '@/db';
import { llmCalls } from '@/db/schema';
import { gte, sql } from 'drizzle-orm';

export const DAILY_TOKEN_GUARDRAIL = 500_000;

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

/** 每次真实调用前读取日累计量；成本护栏读取失败时 fail-closed。 */
export async function assertDailyTokenBudget(): Promise<void> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let tokens: number;
  try {
    const [row] = await db
      .select({ tokens: sql<number>`coalesce(sum(${llmCalls.inTok} + ${llmCalls.outTok}), 0)::int` })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, startOfDay));
    tokens = row?.tokens ?? 0;
  } catch {
    throw new Error('无法读取今日大模型用量，已停止调用以避免超出成本护栏');
  }
  if (tokens >= DAILY_TOKEN_GUARDRAIL) {
    throw new Error(`今日大模型用量已达 ${tokens.toLocaleString()} token，超过 ${DAILY_TOKEN_GUARDRAIL.toLocaleString()} 护栏；请明天再试或调整护栏`);
  }
}
