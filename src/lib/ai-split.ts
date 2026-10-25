/**
 * 语义拆分共享服务端函数：split-preview 与导入时 aiSplit 共用。
 * 流程：RAG 上下文（有段 id 走图谱邻居，无 id 按标题检索）→ 约束式 prompt →
 * chatCompletion → extractJson → 形状校验（2–8 个）。
 * 失败抛可读错误，由调用方决定降级方式（铁律：LLM 失败永不阻断既有功能）。
 */
import { chatCompletion, extractJson } from '@/lib/llm';
import { neighborsOf, retrieveByQuery, type RagHit } from '@/lib/rag';
import { deriveLearnerProfileCached, getLearnerDeclaration, profileToPromptBlock } from '@/lib/learner-profile';

export interface SplitChild {
  title: string;
  content: string;
}

export interface SplitResult {
  children: SplitChild[];
  /** 注入 prompt 的知识库上下文（前端可折叠展示） */
  contextUsed: RagHit[];
}

/** 形状校验与截断：非数组/字段缺失过滤，<2 抛错，>8 截断 */
export function parseSplitChildren(raw: unknown): SplitChild[] {
  if (!Array.isArray(raw)) throw new Error('模型输出形状不符：期望 JSON 数组');
  const children = raw
    .filter(
      (c): c is { title: string; content: string } =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as { title?: unknown }).title === 'string' &&
        typeof (c as { content?: unknown }).content === 'string',
    )
    .map((c) => ({ title: c.title.trim().slice(0, 200), content: c.content.trim() }))
    .filter((c) => c.title && c.content)
    .slice(0, 8);
  if (children.length < 2) throw new Error(`模型输出的可用子段不足（${children.length}/2），请重试或换用其他模型`);
  return children;
}

/** RAG 上下文独立函数：缓存命中路径也能实时计算 contextUsed（不触发 LLM 调用） */
export async function splitContext(seg: { id?: string; title: string }): Promise<RagHit[]> {
  return (seg.id ? neighborsOf(seg.id, 5) : retrieveByQuery(seg.title, 5)).catch(() => []);
}

/**
 * 语义拆分一个段落。
 * - seg.id 存在（编辑态）：RAG 上下文取图谱 1-hop 邻居 top5；
 * - 无 id（导入态）：按标题检索库内相关节点 top5；
 * - kind 写 llm_calls 流水（编辑态 'split'，导入态 'import-split'）。
 */
export async function semanticSplit(
  seg: { id?: string; title: string; content: string },
  kind: 'split' | 'import-split' = 'split',
): Promise<SplitResult> {
  const context = await splitContext(seg);

  // 学习者画像（60s TTL 缓存，导入逐段调用时只推导一次）：薄弱主题的术语首现可附简要解释
  const [profile, declaration] = await Promise.all([
    deriveLearnerProfileCached().catch(() => null),
    getLearnerDeclaration().catch(() => ''),
  ]);
  const profileBlock = profileToPromptBlock(profile, declaration);
  const profileNote = profileBlock
    ? '\n\n' + profileBlock + '\n（拆解/命名时兼顾学习者水平：其记忆薄弱主题的术语首次出现时，可在该子段内用一句话简要解释。）'
    : '';

  const contextBlock = context.length
    ? `\n\n以下是知识库中与该段相关的其他节点（标题 + 摘要）。拆解时避免与它们内容重复，专有名词与术语保持一致：\n${context
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

  const result = await chatCompletion(
    [
      { role: 'system', content: system + contextBlock + profileNote },
      { role: 'user', content: `标题：${seg.title}\n\n内容：\n${seg.content}` },
    ],
    { kind, maxTokens: 4096 },
  );

  return { children: parseSplitChildren(extractJson<unknown>(result.text)), contextUsed: context };
}
