import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';
import { semanticSplit, splitContext } from '@/lib/ai-split';
import { cacheKey, getCachedOutput, saveCachedOutput } from '@/lib/llm-cache';
import { logLlmCall } from '@/lib/llm-calls';

/**
 * 语义拆解预览：单段 → 2–8 个子段（只出 JSON，不落业务表）。
 * 注入 RAG 上下文（图谱 1-hop 邻居 top5）；输出按（模型, 段内容指纹）缓存，命中直接返回。
 * 铁律：本端点无任何写业务操作（llm_cache 除外），应用走 /api/ai/split-apply。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const config = await getLlmConfig();
  if (!config) {
    return NextResponse.json({ error: LLM_SETUP_HINT }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { segmentId?: string };
  const segmentId = body.segmentId ?? '';
  if (!isUuid(segmentId)) return badRequest('segmentId 无效');

  const [seg] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!seg) return notFound('知识点不存在');

  const contextArgs = { id: seg.id, title: seg.title };
  const key = cacheKey('split', config.model, `${seg.title}|${seg.content}`);
  const cached = await getCachedOutput<{ children: { title: string; content: string }[] }>(key);
  if (cached) {
    // 命中：children 来自缓存（省一次模型调用，记一行 cached 流水），contextUsed 仍实时计算（随图谱演进）
    await logLlmCall({ kind: 'split', model: config.model, cached: true });
    const contextUsed = await splitContext(contextArgs);
    return NextResponse.json({ children: cached.children, contextUsed, cached: true });
  }

  const { children, contextUsed } = await semanticSplit({ id: seg.id, title: seg.title, content: seg.content });
  await saveCachedOutput(key, 'split', config.model, { children });

  return NextResponse.json({ children, contextUsed, cached: false });
}
