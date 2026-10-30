import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard, isUuid, notFound } from '@/lib/api';
import { deriveLearnerProfileCached, getLearnerDeclaration, profileToPromptBlock } from '@/lib/learner-profile';
import { chatCompletion, resolveLlmStatus } from '@/lib/llm';
import { buildContextBudget, neighborsOf } from '@/lib/rag';

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { segmentIds?: unknown };
  const ids = Array.isArray(body.segmentIds)
    ? [...new Set(body.segmentIds.filter((value): value is string => typeof value === 'string'))]
    : [];
  if (ids.length !== 2 || !ids.every(isUuid)) return badRequest('请选择两个有效的知识点');

  const rows = await db
    .select({
      id: segments.id,
      title: segments.title,
      content: segments.content,
      documentTitle: documents.title,
    })
    .from(segments)
    .leftJoin(documents, eq(segments.documentId, documents.id))
    .where(inArray(segments.id, ids));
  if (rows.length !== 2) return notFound('部分知识点不存在');

  const status = await resolveLlmStatus();
  if (!status.ok) return NextResponse.json({ error: status.hint }, { status: 503 });

  const [first, second] = ids.map((id) => rows.find((row) => row.id === id)!);
  const [neighbors, profile, declaration] = await Promise.all([
    neighborsOf(ids, 6).catch(() => []),
    deriveLearnerProfileCached().catch(() => null),
    getLearnerDeclaration().catch(() => ''),
  ]);
  const profileBlock = profileToPromptBlock(profile, declaration);
  const budget = buildContextBudget({
    material: [
      `概念 A：${first.title}（${first.documentTitle ?? '未知文档'}）\n${first.content}`,
      `概念 B：${second.title}（${second.documentTitle ?? '未知文档'}）\n${second.content}`,
    ].join('\n\n'),
    profileBlock,
    ragHits: neighbors,
  });
  const sharedBlock = budget.contextBlock
    ? `\n共同邻居/相关知识：\n${budget.contextBlock}`
    : '\n两者没有直接可用的共同邻居，请只依据原文比较。';

  try {
    const result = await chatCompletion(
      [
        {
          role: 'system',
          content: [
            '你是知识关系解释助手。比较两个知识点，并说明它们如何联系。',
            '输出 Markdown，结构固定为：一句话结论；共同点；关键差异；一个具体联系场景。',
            '只依据提供的原文和邻居，不编造外部事实；不超过 500 字。',
            profileBlock ? `\n${profileBlock}\n请根据学习者薄弱点调整解释深度。` : '',
            sharedBlock,
          ].join('\n'),
        },
        { role: 'user', content: budget.material },
      ],
      { kind: 'connect', maxTokens: 1_000, temperature: 0.2 },
    );
    const explanation = result.text.trim();
    if (!explanation) return NextResponse.json({ error: '模型未返回可读解释' }, { status: 502 });
    return NextResponse.json({
      explanation,
      segments: [first, second].map(({ id, title, documentTitle }) => ({ id, title, documentTitle })),
      contextUsed: budget.contextUsed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `关联解释失败：${error instanceof Error ? error.message : '未知错误'}` },
      { status: 502 },
    );
  }
}
