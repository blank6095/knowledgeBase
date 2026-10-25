import { NextRequest, NextResponse } from 'next/server';
import { asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { chatCompletion, extractJson, getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';
import { neighborsOf } from '@/lib/rag';

/**
 * 语义聚合预览：同文档多段 → 1 段融合稿（只出 JSON，不落库）。
 * 注入 RAG 上下文（所选段集的图谱 1-hop 邻居 top5）避免与库内其他节点内容重复。
 * 铁律：本端点无任何写操作，应用走 /api/ai/aggregate-apply。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  if (!(await getLlmConfig())) {
    return NextResponse.json({ error: LLM_SETUP_HINT }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { segmentIds?: unknown };
  const ids = Array.isArray(body.segmentIds) ? body.segmentIds.filter((v): v is string => typeof v === 'string') : [];
  if (ids.length < 2) return badRequest('至少选择 2 个知识点');
  if (ids.length > 20) return badRequest('一次最多聚合 20 个知识点');
  if (!ids.every((v) => isUuid(v))) return badRequest('segmentIds 含无效 id');

  const rows = await db.select().from(segments).where(inArray(segments.id, ids)).orderBy(asc(segments.orderIndex));
  if (rows.length !== ids.length) return notFound('部分知识点不存在');
  const docIds = new Set(rows.map((r) => r.documentId));
  if (docIds.size > 1) return badRequest('只能聚合同一文档下的知识点');

  const parts = rows.map((r, i) => `【段落 ${i + 1}】标题：${r.title}\n内容：\n${r.content}`).join('\n\n');

  // RAG 上下文：选中段集的图谱 1-hop 邻居 top5（失败降级为空，不阻断聚合）
  const neighbors = await neighborsOf(ids, 5).catch(() => []);
  const contextBlock = neighbors.length
    ? `\n\n以下是知识库中与这些段落相关的其他节点（标题 + 摘要）。融合时避免与它们内容重复，专有名词与术语保持一致：\n${neighbors
        .map((n) => `- ${n.title}：${n.snippet}`)
        .join('\n')}`
    : '';

  const system = [
    '你是个人知识库的编辑助手。把给定的多个知识段落聚合为一个段落。要求：',
    '1. 融合去重：重复表述合并，但不得丢失任何段落的任何事实；',
    '2. content 用 Markdown 连贯成文（可用小标题/列表组织），风格与原文一致；',
    '3. title 简洁（不超过 20 字），概括融合后的核心；',
    '4. 只重组、不增删事实：不得添加原文没有的信息。',
    '只输出 JSON 对象，格式：{"title":"...","content":"..."}，不要输出任何其他文字或解释。',
  ].join('\n');
  const user = `以下是需要聚合的 ${rows.length} 个段落：\n\n${parts}`;

  const output = await chatCompletion([
    { role: 'system', content: system + contextBlock },
    { role: 'user', content: user },
  ]);

  const raw = extractJson<{ title?: unknown; content?: unknown }>(output);
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || typeof raw.content !== 'string') {
    return badRequest('模型输出形状不符：期望 {"title":"...","content":"..."}');
  }
  const merged = { title: raw.title.trim().slice(0, 200), content: raw.content.trim() };
  if (!merged.title || !merged.content) return badRequest('模型输出的标题或内容为空');

  return NextResponse.json({
    merged,
    contextUsed: neighbors.map((n) => ({ segmentId: n.segmentId, title: n.title, snippet: n.snippet })),
  });
}
