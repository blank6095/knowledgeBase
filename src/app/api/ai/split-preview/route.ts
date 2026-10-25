import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { chatCompletion, extractJson, getLlmConfig, LLM_SETUP_HINT } from '@/lib/llm';
import { neighborsOf } from '@/lib/rag';

/**
 * 语义拆解预览：单段 → 2–8 个子段（只出 JSON，不落库）。
 * 注入 RAG 上下文（图谱 1-hop 邻居 top5）避免与库内其他节点内容重复。
 * 铁律：本端点无任何写操作，应用走 /api/ai/split-apply。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  if (!(await getLlmConfig())) {
    return NextResponse.json({ error: LLM_SETUP_HINT }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { segmentId?: string };
  const segmentId = body.segmentId ?? '';
  if (!isUuid(segmentId)) return badRequest('segmentId 无效');

  const [seg] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!seg) return notFound('知识点不存在');

  // RAG 上下文：图谱 1-hop 邻居 top5（失败降级为空，不阻断拆解）
  const neighbors = await neighborsOf(segmentId, 5).catch(() => []);
  const contextBlock = neighbors.length
    ? `\n\n以下是知识库中与该段相关的其他节点（标题 + 摘要）。拆解时避免与它们内容重复，专有名词与术语保持一致：\n${neighbors
        .map((n) => `- ${n.title}：${n.snippet}`)
        .join('\n')}`
    : '';

  const system = [
    '你是个人知识库的编辑助手。把给定的知识段落拆分为 2-8 个更小的子段落。要求：',
    '1. 只重组、不增删事实：不得添加原文没有的信息，也不得丢失原文的任何事实；',
    '2. content 保持 Markdown 格式，与原文风格一致；',
    '3. 每个子段独立可读（脱离上下文也能看懂），子段之间不重复；',
    '4. title 简洁（不超过 20 字），概括该子段核心。',
    '只输出 JSON 数组，格式：[{"title":"...","content":"..."}]，不要输出任何其他文字或解释。',
  ].join('\n');
  const user = `标题：${seg.title}\n\n内容：\n${seg.content}`;

  const output = await chatCompletion([
    { role: 'system', content: system + contextBlock },
    { role: 'user', content: user },
  ]);

  const raw = extractJson<unknown>(output);
  if (!Array.isArray(raw)) {
    return badRequest('模型输出形状不符：期望 JSON 数组');
  }
  const children = raw
    .filter(
      (c): c is { title: string; content: string } =>
        !!c && typeof c === 'object' && typeof (c as { title?: unknown }).title === 'string' && typeof (c as { content?: unknown }).content === 'string',
    )
    .map((c) => ({ title: c.title.trim().slice(0, 200), content: c.content.trim() }))
    .filter((c) => c.title && c.content)
    .slice(0, 8);
  if (children.length < 2) {
    return badRequest(`模型输出的可用子段不足（${children.length}/2），请重试或换用其他模型`);
  }

  return NextResponse.json({
    children,
    contextUsed: neighbors.map((n) => ({ segmentId: n.segmentId, title: n.title, snippet: n.snippet })),
  });
}
