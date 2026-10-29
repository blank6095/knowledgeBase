import { cacheKey, getCachedOutput, saveCachedOutput } from '@/lib/llm-cache';
import { chatCompletion, extractJson, pickModel, resolveLlmStatus } from '@/lib/llm';
import { stripMarkdown } from '@/lib/markdown';
import { sourceVersion } from '@/lib/learning-plan';

export interface RecallSegment {
  id: string;
  title: string;
  content: string;
  summary: string | null;
}

export interface RecallQuestion {
  question: string;
  referenceAnswer: string;
  sourceVersion: string;
  generatedBy: 'cache' | 'ai' | 'fallback';
  warning?: string;
}

export function normalizeRecallQuestion(raw: unknown): { question: string; referenceAnswer: string } {
  if (!raw || typeof raw !== 'object') throw new Error('题目输出形状不符');
  const question = typeof (raw as { question?: unknown }).question === 'string' ? (raw as { question: string }).question.trim() : '';
  const referenceAnswer =
    typeof (raw as { referenceAnswer?: unknown }).referenceAnswer === 'string'
      ? (raw as { referenceAnswer: string }).referenceAnswer.trim()
      : '';
  if (!question || !referenceAnswer) throw new Error('题目或参考答案为空');
  return {
    question: question.slice(0, 800),
    referenceAnswer: referenceAnswer.slice(0, 4_000),
  };
}

export function fallbackRecallQuestion(segment: RecallSegment): RecallQuestion {
  return {
    question: `请不看原文，用自己的话复述「${segment.title}」的核心内容，并指出至少一个关键结论。`,
    referenceAnswer: (segment.summary?.trim() || stripMarkdown(segment.content) || segment.content).slice(0, 4_000),
    sourceVersion: sourceVersion(segment.title, segment.content),
    generatedBy: 'fallback',
  };
}

export async function generateRecallQuestion(segment: RecallSegment): Promise<RecallQuestion> {
  const version = sourceVersion(segment.title, segment.content);
  const status = await resolveLlmStatus();
  if (!status.ok) {
    return {
      ...fallbackRecallQuestion(segment),
      warning: '当前未配置大模型，已使用原文复述题。',
    };
  }

  const model = pickModel(status.config, 'fast');
  const key = cacheKey('recall-question', model, `${segment.id}|${version}`);
  const cached = await getCachedOutput<{ question: string; referenceAnswer: string }>(key).catch(() => null);
  if (cached) {
    try {
      return { ...normalizeRecallQuestion(cached), sourceVersion: version, generatedBy: 'cache' };
    } catch {
      // 旧缓存形状不合法时继续生成并覆盖。
    }
  }

  try {
    const result = await chatCompletion(
      [
        {
          role: 'system',
          content: [
            '你负责为一则个人知识笔记生成最小主动回忆题。',
            '题目必须只能依据给定原文作答，避免暗示答案，也不要考察原文外的信息。',
            '参考答案只能是对原文事实的简洁整理，不得补充原文没有的内容。',
            '只输出 JSON：{"question":"...","referenceAnswer":"..."}。',
          ].join('\n'),
        },
        { role: 'user', content: `标题：${segment.title}\n\n原文：\n${segment.content.slice(0, 6_000)}` },
      ],
      { kind: 'recall-question', tier: 'fast', maxTokens: 600 },
    );
    const generated = normalizeRecallQuestion(extractJson<unknown>(result.text));
    await saveCachedOutput(key, 'recall-question', model, generated).catch(() => {});
    return { ...generated, sourceVersion: version, generatedBy: 'ai' };
  } catch (error) {
    return {
      ...fallbackRecallQuestion(segment),
      warning: `AI 出题失败，已使用原文复述题：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}
