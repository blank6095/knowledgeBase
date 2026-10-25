import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { badRequest, guard } from '@/lib/api';
import { chatCompletionStream, resolveLlmStatus, type ChatMessage } from '@/lib/llm';
import { retrieveByQuery } from '@/lib/rag';
import { deriveLearnerProfileCached, getLearnerDeclaration, profileToPromptBlock } from '@/lib/learner-profile';
import { cacheKey, getCachedOutput, saveCachedOutput } from '@/lib/llm-cache';
import { logLlmCall } from '@/lib/llm-calls';

/** 建议类意图：命中则旁路为学习教练模式（画像为主、材料为参考），而非纯材料问答 */
const ADVICE_RE = /推荐|建议|接下来|下一步|学什么|复习|先学|规划|顺序|薄弱|优先/;

/** 上下文预算（L2-1）：材料优先、画像其次，超出裁剪，防 prompt 膨胀 */
const SNIPPET_MAX = 160;
const CONTEXT_CHAR_BUDGET = 3600;
const PROFILE_CHAR_BUDGET = 400;
/** ask 结果缓存 TTL（L2-2）：画像不参与 key（单用户取舍，与 preview 缓存口径一致） */
const ASK_TTL_HOURS = 24;

interface AskCached {
  answer: string;
  sources: { segmentId: string; title: string }[];
}

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * 问知识库（流式）：retrieveByQuery(top 6) 取材料 → 约束式 prompt → SSE 逐字返回，
 * 末包附来源与缓存标记。注入学习者画像；建议类问题切换为教练模式。
 * 命中 ask 缓存（query+材料指纹+声明文本，24h）直接秒回，不调模型。
 * 库内无相关内容且非建议类：不调模型，返回 JSON 明确告知（杜绝编造）。
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const status = await resolveLlmStatus();
  if (!status.ok) {
    return NextResponse.json({ error: status.hint }, { status: 503 });
  }
  const model = status.config.model;

  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
  if (!query) return badRequest('请输入问题');

  const materials = await retrieveByQuery(query, 6);

  // 库内无相关内容且非建议类：不调用模型，直接明确告知
  const isAdvice = ADVICE_RE.test(query);
  if (materials.length === 0 && !isAdvice) {
    return NextResponse.json({
      answer: '知识库中没有找到与这个问题相关的内容，暂时无法回答。可以先在「知识库」导入相关笔记，或换个问法再试。',
      sources: [],
    });
  }

  const [profile, declaration] = await Promise.all([
    deriveLearnerProfileCached().catch(() => null),
    getLearnerDeclaration().catch(() => ''),
  ]);
  const profileBlock = profileToPromptBlock(profile, declaration).slice(0, PROFILE_CHAR_BUDGET);

  // L2-1：逐条裁剪材料摘要，总量不超预算（材料优先）
  let used = 0;
  const trimmed = materials.map((m) => {
    const snippet = m.snippet.slice(0, SNIPPET_MAX);
    used += snippet.length + m.title.length + 8;
    return { ...m, snippet };
  });
  while (used > CONTEXT_CHAR_BUDGET && trimmed.length > 1) {
    const drop = trimmed.pop()!;
    used -= drop.snippet.length + drop.title.length + 8;
  }

  const context = trimmed
    .map((m, i) => `【材料 ${i + 1}】《${m.title}》\n${m.snippet}`)
    .join('\n\n');
  const sources = trimmed.map((m) => ({ segmentId: m.segmentId, title: m.title }));

  let system: string;
  if (isAdvice) {
    system = [
      '你是个人知识库「暗夜书房」的学习教练。学习者的问题是：' + query,
      '',
      profileBlock ? '学习者画像：\n' + profileBlock : '（暂无学习者画像数据。）',
      '',
      '知识库检索到的相关材料（供参考，可与画像结合）：',
      context || '（无直接相关材料）',
      '',
      '任务：结合学习者画像（记忆薄弱点、未读主题、阅读节奏）与材料，给出具体的下一步学习建议。',
      '要求：1) 建议要可执行（指明先看哪个主题/知识点、为什么）；2) 引用材料或画像时可标注（来源 n）；',
      '3) 信息不足时明确说明依据的是画像推断还是库内材料，不得编造库中不存在的内容。',
    ].join('\n');
  } else {
    system = [
      '你是个人知识库「暗夜书房」的问答助手。回答规则：',
      '1. 仅基于下面给定的知识库材料回答，不得使用材料之外的知识，不得编造；',
      '2. 材料不足以完整回答问题时，明确说明材料中只有哪些相关信息、缺什么，不要强行下结论；',
      '3. 用 Markdown 简洁作答（可列表），语气与知识库一致；引用了某段材料可在句末标注（来源 n）。',
      profileBlock ? '\n' + profileBlock + '\n（回答时兼顾学习者水平：对其记忆薄弱的主题，术语首次出现可附一句简要解释。）' : '',
      '',
      '知识库材料：',
      context,
    ].join('\n');
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: query },
  ];

  // L2-2 ask 缓存：query + 材料指纹 + 声明文本 + 模式 → 命中秒回（记 cached 一行流水）
  const fingerprint = createHash('sha256')
    .update([query, isAdvice ? 'advice' : 'qa', declaration, sources.map((s) => `${s.segmentId}|${s.title}`).join(',')].join('\u0000'))
    .digest('hex');
  const key = cacheKey('ask', model, fingerprint);
  const cached = await getCachedOutput<AskCached>(key).catch(() => null);
  if (cached?.answer) {
    await logLlmCall({ kind: 'ask', model, cached: true });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse({ delta: cached.answer })));
        controller.enqueue(
          new TextEncoder().encode(sse({ done: true, sources: cached.sources ?? [], cached: true, adviceMode: isAdvice })),
        );
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders });
  }

  // 流式调用：逐 delta 转发，末包带来源；成功后写缓存与流水
  const started = Date.now();
  try {
    const handle = await chatCompletionStream(messages, { kind: 'ask', maxTokens: 2048 });
    const upstream = handle.response;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let answer = '';
        let inTok = 0;
        let outTok = 0;
        try {
          const reader = upstream.body!.getReader();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;
              const data = t.slice(5).trim();
              if (data === '[DONE]') continue;
              let payload: {
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              try {
                payload = JSON.parse(data);
              } catch {
                continue;
              }
              const delta = payload.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                answer += delta;
                controller.enqueue(encoder.encode(sse({ delta })));
              }
              if (payload.usage) {
                inTok = payload.usage.prompt_tokens ?? inTok;
                outTok = payload.usage.completion_tokens ?? outTok;
              }
            }
          }
          if (!answer.trim()) throw new Error('大模型流式返回为空');
          await saveCachedOutput(key, 'ask', model, { answer, sources }, new Date(Date.now() + ASK_TTL_HOURS * 3600_000)).catch(() => {});
          await logLlmCall({ kind: 'ask', model, inTok, outTok, ms: Date.now() - started });
          controller.enqueue(encoder.encode(sse({ done: true, sources, cached: false, adviceMode: isAdvice })));
        } catch (e) {
          await logLlmCall({ kind: 'ask', model, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
          controller.enqueue(encoder.encode(sse({ error: e instanceof Error ? e.message : '流式生成失败' })));
        } finally {
          handle.release();
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: sseHeaders });
  } catch (e) {
    // 请求未建立（配置/网络/重试耗尽）：整体 JSON 错误，前端走既有错误路径
    const message = e instanceof Error ? e.message : '问答失败';
    await logLlmCall({ kind: 'ask', model, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
