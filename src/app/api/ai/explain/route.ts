import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { deriveLearnerProfileCached, getLearnerDeclaration, profileToPromptBlock } from '@/lib/learner-profile';
import { chatCompletion, resolveLlmStatus } from '@/lib/llm';
import { buildContextBudget, neighborsOf } from '@/lib/rag';

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { segmentId?: unknown; quote?: unknown };
  if (typeof body.segmentId !== 'string' || !isUuid(body.segmentId)) return badRequest('segmentId 无效');
  const quote = typeof body.quote === 'string' ? body.quote.trim().slice(0, 1_000) : '';
  if (quote.length < 2) return badRequest('请选择至少两个字符的正文');

  const [segment] = await db
    .select({
      id: segments.id,
      title: segments.title,
      content: segments.content,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id))
    .where(eq(segments.id, body.segmentId));
  if (!segment) return notFound('知识点不存在');

  const status = await resolveLlmStatus();
  if (!status.ok) {
    return NextResponse.json({ error: status.hint }, { status: 503 });
  }

  const context = await neighborsOf(segment.id, 4).catch(() => []);
  const [profile, declaration] = await Promise.all([
    deriveLearnerProfileCached().catch(() => null),
    getLearnerDeclaration().catch(() => ''),
  ]);
  const profileBlock = profileToPromptBlock(profile, declaration);
  const budget = buildContextBudget({
    material: `文档：${segment.documentTitle ?? '未知'}\n知识点：${segment.title}\n原文：\n${segment.content}`,
    profileBlock,
    ragHits: context,
  });
  const relationBlock = budget.contextBlock
    ? `\n\n相关知识（只用于建立联系，不得臆测原文未写的事实）：\n${budget.contextBlock}`
    : '';

  try {
    const result = await chatCompletion(
      [
        {
          role: 'system',
          content: [
            '你是个人知识库的阅读解释助手。',
            '解释用户选中的一段话：先用通俗中文说明它在本知识点中的含义，再给一个具体例子，最后指出与相关知识的联系。',
            '只依据提供的原文和相关片段，不补充无法追溯的外部事实；引用原文时保持简短。',
            profileBlock ? `\n${profileBlock}\n请根据学习者当前薄弱主题调整解释深度。` : '',
            relationBlock,
            '输出简洁 Markdown，不超过 500 字。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `${budget.material}\n\n需要解释的选中文字：\n“${quote}”`,
        },
      ],
      { kind: 'explain', maxTokens: 900, temperature: 0.2 },
    );
    const explanation = result.text.trim();
    if (!explanation) return NextResponse.json({ error: '模型未返回可读解释' }, { status: 502 });
    return NextResponse.json({
      explanation,
      segment: { id: segment.id, title: segment.title, documentTitle: segment.documentTitle ?? '未知文档' },
      contextUsed: budget.contextUsed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `解释失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 502 },
    );
  }
}
