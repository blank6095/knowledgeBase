import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, segments } from '@/db/schema';
import { badRequest, guard } from '@/lib/api';
import { chatCompletionStream, extractJson, resolveLlmStatus, type ChatMessage, type ToolCallRef } from '@/lib/llm';
import { retrieveByQuery } from '@/lib/rag';
import { deriveLearnerProfileCached, getLearnerDeclaration, profileToPromptBlock } from '@/lib/learner-profile';
import { buildKbOverview } from '@/lib/kb-overview';
import { AGENT_TOOLS, mergeToolCallDelta, validateActions, type AgentAction } from '@/lib/agent-tools';
import { logLlmCall } from '@/lib/llm-calls';
import { readWithIdleTimeout } from '@/lib/stream-utils';
import { cacheKey, getCachedOutput, saveCachedOutput } from '@/lib/llm-cache';

/**
 * 知识库助手 Agent（v15 范式替换：检索式问答 → 自主决定何时检索的对话 Agent）。
 *
 * - 常驻上下文：知识库概览块（kb-overview ≤600 字）+ 学习者画像块（≤400 字）每轮注入 system；
 * - 工具集（服务端执行，OpenAI tools）：search_knowledge / read_segment / propose_actions。
 *   propose_actions 只提议不执行——LLM 输出永不直接写库，由前端确认卡走 v10 端点；
 * - 循环上限 3 轮工具调用，超限直答收尾；每轮写 llm_calls(kind='ask-agent')；
 * - 多轮对话：客户端携 history（≤10 条），服务端无状态；
 * - ask 缓存仅覆盖无工具、无改动提议的直接回答（24h TTL）；工具材料在请求前不可知，不重放陈旧检索结果；
 * - 本版移除：ADVICE_RE/advice 路由与教练 prompt、材料不足死胡同文案（Agent 凭常驻上下文如实回答取代）；
 * - Step 0 说明：deepseek-v4-flash 的 function calling 未实测（本环境无 API Key 无法验证）；
 *   若上游对 tools 参数返回 400，自动降级为无工具直答（mode:'agent-notools'），行为不中断。
 */

const MAX_TOOL_ROUNDS = 3;
const HISTORY_LIMIT = 10;
const STREAM_IDLE_TIMEOUT_MS = 30_000;

interface SourceItem {
  segmentId: string;
  title: string;
}

type EnrichedAction = AgentAction & {
  current?: { title?: string; tags?: string[]; contentPreview?: string };
};

const sseHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return extractJson<Record<string, unknown>>(raw);
  }
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;

  const status = await resolveLlmStatus();
  if (!status.ok) {
    return NextResponse.json({ error: status.hint }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: unknown; history?: unknown };
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
  if (!query) return badRequest('请输入问题');
  const history: ChatMessage[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            !!m &&
            typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string',
        )
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    : [];

  // 空库静态早退：导入引导（Agent 无从答起，不调模型）
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(segments);
  if (total === 0) {
    return NextResponse.json({
      answer:
        '知识库还是空的——先到「导入」页放入第一篇 Markdown，我才能基于你的内容问答、帮你整理段落。\n\n导入后可以问我「你能帮我做什么」，或直接让我改标题、拆段落。',
      sources: [],
      mode: 'agent',
    });
  }

  // 常驻上下文两块（任一失败置空串，不阻断）
  const [overviewBlock, profileBlock] = await Promise.all([
    buildKbOverview().catch(() => ''),
    (async () =>
      profileToPromptBlock(
        await deriveLearnerProfileCached().catch(() => null),
        await getLearnerDeclaration().catch(() => ''),
      ))().catch(() => ''),
  ]);

  const system = [
    '你是个人知识库「暗夜书房」的助手，常驻了解下面的知识库概览与学习者画像。',
    overviewBlock,
    profileBlock,
    '',
    '行为规则：',
    '1. 凭上下文能答的直接答；需要库内具体细节（某知识点全文、精确表述）时，先调 search_knowledge / read_segment 再回答；',
    '2. 管理类请求（改标题/内容/标签、删除知识点、插入知识点、改文档信息）必须通过 propose_actions 提议，并在回答中逐项说明将要改什么；segmentId/documentId 只能来自工具返回，绝不虚构；',
    '3. 知识库中不存在的内容要如实说明，可从概览给出最接近的主题，不得编造；',
    '4. 回答用简洁中文 Markdown；引用了某知识点时可附《标题》。',
  ].join('\n');

  const askCacheKey = cacheKey(
    'ask',
    status.config.model,
    JSON.stringify({ query, history, overviewBlock, profileBlock }),
  );
  const cachedAnswer = await getCachedOutput<{ answer: string; mode: 'agent' | 'agent-notools' }>(askCacheKey).catch(
    () => null,
  );
  if (cachedAnswer?.answer) {
    await logLlmCall({ kind: 'ask-agent', model: status.config.model, cached: true });
    const cachedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(sse({ delta: cachedAnswer.answer })));
        controller.enqueue(
          encoder.encode(sse({ done: true, sources: [], actions: [], mode: cachedAnswer.mode, cached: true })),
        );
        controller.close();
      },
    });
    return new Response(cachedStream, { headers: { ...sseHeaders, 'X-Cache': 'HIT' } });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)));
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: query }];

      const sources: SourceItem[] = [];
      const seenSources = new Set<string>();
      let proposed: AgentAction[] = [];
      let degraded = false; // 上游不支持 tools → 无工具直答
      let finalAnswer = '';
      let usedTools = false;
      let cacheableDirectAnswer = false;

      try {
        for (let iter = 0; iter <= MAX_TOOL_ROUNDS + 1; iter++) {
          const allowTools = !degraded && iter < MAX_TOOL_ROUNDS;
          const started = Date.now();
          let handle: Awaited<ReturnType<typeof chatCompletionStream>>;
          try {
            handle = await chatCompletionStream(messages, {
              kind: 'ask-agent',
              maxTokens: 2048,
              ...(allowTools ? { tools: AGENT_TOOLS as unknown as unknown[] } : {}),
            });
          } catch (e) {
            const err = e as { status?: number; message: string };
            // Step 0 降级：上游对 tools 参数报 400（不支持 function calling）→ 去掉 tools 重试本轮
            if (err.status === 400 && allowTools) {
              degraded = true;
              await logLlmCall({
                kind: 'ask-agent',
                model: status.config.model,
                ms: Date.now() - started,
                error: `tools 不可用，降级直答：${err.message.slice(0, 120)}`,
              });
              iter--;
              continue;
            }
            throw e;
          }

          // 解析上游 SSE：转发 content delta、累积 tool_call 分片、捕获 usage
          let acc = '';
          const calls = new Map<number, { id: string; name: string; args: string }>();
          let inTok = 0;
          let outTok = 0;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            handle.release();
          };
          try {
            const reader = handle.response.body!.getReader();
            let buf = '';
            for (;;) {
              const { done, value } = await readWithIdleTimeout(reader, STREAM_IDLE_TIMEOUT_MS);
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
                  choices?: {
                    delta?: {
                      content?: string;
                      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
                    };
                  }[];
                  usage?: { prompt_tokens?: number; completion_tokens?: number };
                };
                try {
                  payload = JSON.parse(data);
                } catch {
                  continue;
                }
                const delta = payload.choices?.[0]?.delta;
                if (typeof delta?.content === 'string' && delta.content) {
                  acc += delta.content;
                  send({ delta: delta.content });
                }
                for (const tc of delta?.tool_calls ?? []) mergeToolCallDelta(calls, tc);
                if (payload.usage) {
                  inTok = payload.usage.prompt_tokens ?? inTok;
                  outTok = payload.usage.completion_tokens ?? outTok;
                }
              }
            }
          } finally {
            release();
          }
          await logLlmCall({ kind: 'ask-agent', model: handle.model, inTok, outTok, ms: Date.now() - started });

          const toolCalls: ToolCallRef[] = [...calls.values()]
            .filter((c) => c.name)
            .map((c) => ({
              id: c.id || `call_${Math.random().toString(36).slice(2)}`,
              type: 'function' as const,
              function: { name: c.name, arguments: c.args || '{}' },
            }));

          if (toolCalls.length === 0) {
            finalAnswer = acc;
            cacheableDirectAnswer = Boolean(acc.trim());
            break;
          }

          usedTools = true;
          // 工具轮：执行并回填（OpenAI 要求每个 tool_call 都有 tool 消息响应）
          messages.push({ role: 'assistant', content: acc, tool_calls: toolCalls });
          for (const call of toolCalls) {
            let resultText: string;
            try {
              resultText = await executeTool(call.function.name, parseArgs(call.function.arguments), {
                send,
                sources,
                seenSources,
                onPropose: (actions) => {
                  proposed = actions;
                },
              });
            } catch (e) {
              resultText = `工具执行失败：${e instanceof Error ? e.message : String(e)}（请基于已有信息回答，不要虚构）`;
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
          }
        }

        if (!finalAnswer.trim()) {
          finalAnswer = proposed.length ? '以上是我建议的改动，请在下方确认卡逐项确认。' : '（这轮没有生成内容，请重试或换个问法。）';
        }

        // 给确认卡补充「改动前」信息（update/delete 的对照需要）
        const enriched = await enrichActions(proposed).catch(() => proposed.map((a) => ({ ...a }) as EnrichedAction));

        send({
          done: true,
          sources: sources.slice(0, 8),
          actions: enriched,
          mode: degraded ? 'agent-notools' : 'agent',
        });
        if (cacheableDirectAnswer && !usedTools && proposed.length === 0 && finalAnswer.trim()) {
          await saveCachedOutput(
            askCacheKey,
            'ask',
            status.config.model,
            { answer: finalAnswer, mode: degraded ? 'agent-notools' : 'agent' },
            new Date(Date.now() + 24 * 60 * 60 * 1_000),
          ).catch(() => {});
        }
      } catch (e) {
        await logLlmCall({ kind: 'ask-agent', model: status.config.model, error: e instanceof Error ? e.message : String(e) });
        send({ error: e instanceof Error ? e.message : '助手暂时不可用' });
      } finally {
        try {
          controller.close();
        } catch {
          // 客户端已断开时流可能已关闭。
        }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}

/** 执行单次工具调用（仅检索/读取/收集提议，零写库） */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    send: (p: unknown) => void;
    sources: SourceItem[];
    seenSources: Set<string>;
    onPropose: (actions: AgentAction[]) => void;
  },
): Promise<string> {
  if (name === 'search_knowledge') {
    ctx.send({ status: '查阅知识库…' });
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : '';
    if (!query) return 'query 为空';
    const topK = Math.min(Math.max(Number(args.top_k) || 6, 1), 8);
    const hits = await retrieveByQuery(query, topK);
    const memoryById = new Map<string, number>();
    if (hits.length) {
      const m = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
      const rows = await db
        .select({ id: segments.id, memory: sql<number>`(${m})::float` })
        .from(segments)
        .where(inArray(segments.id, hits.map((h) => h.segmentId)));
      rows.forEach((r) => memoryById.set(r.id, Math.round(r.memory * 100) / 100));
    }
    for (const h of hits) {
      if (!ctx.seenSources.has(h.segmentId)) {
        ctx.seenSources.add(h.segmentId);
        ctx.sources.push({ segmentId: h.segmentId, title: h.title });
      }
    }
    if (hits.length === 0) return '没有检索到相关知识点。可换关键词，或基于概览如实告知库内没有。';
    return JSON.stringify(
      hits.map((h) => ({ segmentId: h.segmentId, title: h.title, snippet: h.snippet, memory: memoryById.get(h.segmentId) ?? null })),
    );
  }

  if (name === 'read_segment') {
    ctx.send({ status: '读取知识点…' });
    const id = String(args.segmentId ?? '').trim();
    const m = sql`exp(-extract(epoch from (now() - ${segments.lastViewedAt})) / 86400.0 / greatest(${segments.stability}, 1e-9))`;
    const [seg] = await db
      .select({
        id: segments.id,
        title: segments.title,
        content: segments.content,
        tags: segments.tags,
        memory: sql<number>`(${m})::float`,
        documentId: segments.documentId,
      })
      .from(segments)
      .where(eq(segments.id, id));
    if (!seg) return '未找到该知识点（segmentId 无效）。请先 search_knowledge 获取有效 id。';
    if (!ctx.seenSources.has(seg.id)) {
      ctx.seenSources.add(seg.id);
      ctx.sources.push({ segmentId: seg.id, title: seg.title });
    }
    return JSON.stringify({ ...seg, memory: Math.round(seg.memory * 100) / 100, content: seg.content.slice(0, 3000) });
  }

  if (name === 'propose_actions') {
    ctx.send({ status: '整理改动提议…' });
    const { actions, errors } = validateActions(args.actions);
    if (actions.length === 0) {
      return `提议全部无效：${errors.join('；')}。请修正后重发，或放弃提议直接回答。`;
    }
    ctx.onPropose(actions);
    const errNote = errors.length ? `（${errors.length} 项无效已忽略）` : '';
    return `已收到 ${actions.length} 项提议${errNote}。系统会向用户展示确认卡；请在最终回答中逐项说明将改动什么。`;
  }

  return `未知工具 ${name}`;
}

/** 为确认卡补充改动前信息：segment 的现标题/标签/内容预览，document 的现标题 */
async function enrichActions(actions: AgentAction[]): Promise<EnrichedAction[]> {
  const segIds = actions
    .filter((a) => a.type === 'update_segment' || a.type === 'delete_segment')
    .map((a) => (a as { segmentId: string }).segmentId);
  const docIds = actions
    .filter((a) => a.type === 'create_segment' || a.type === 'update_document')
    .map((a) => (a as { documentId: string }).documentId);

  const [segRows, docRows] = await Promise.all([
    segIds.length
      ? db
          .select({ id: segments.id, title: segments.title, tags: segments.tags, content: segments.content })
          .from(segments)
          .where(inArray(segments.id, segIds))
      : Promise.resolve([] as { id: string; title: string; tags: string[]; content: string }[]),
    docIds.length
      ? db.select({ id: documents.id, title: documents.title, tags: documents.tags }).from(documents).where(inArray(documents.id, docIds))
      : Promise.resolve([] as { id: string; title: string; tags: string[] }[]),
  ]);
  const segMap = new Map(segRows.map((r) => [r.id, r]));
  const docMap = new Map(docRows.map((r) => [r.id, r]));

  return actions.map((a) => {
    if (a.type === 'update_segment' || a.type === 'delete_segment') {
      const cur = segMap.get(a.segmentId);
      return cur ? { ...a, current: { title: cur.title, tags: cur.tags, contentPreview: cur.content.slice(0, 120) } } : ({ ...a } as EnrichedAction);
    }
    const cur = docMap.get(a.documentId);
    return cur ? { ...a, current: { title: cur.title, tags: cur.tags } } : ({ ...a } as EnrichedAction);
  });
}
