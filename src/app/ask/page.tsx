'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError, api, isAuthError } from '@/lib/client';
import {
  ASK_CONTEXT_PARAM_PATH,
  ASK_CONTEXT_PARAM_SEGMENT,
  ASK_SEGMENT_SUGGESTION,
  buildAskRequestBody,
  buildSuggestQuestion,
  parseAskContext,
  type AskContextKind,
} from '@/lib/ai/ask-context';
import {
  EMPTY_STREAM_MESSAGE,
  HISTORY_LIMIT,
  PARTIAL_STREAM_NOTE,
  appendTurn,
  buildConversationMessages,
  canApplyActions,
  isActionRetryable,
  pendingActionIndexes,
  resolveStreamFinish,
  retryableActionIndexes,
  type ConversationMessage,
  type ConversationSource,
  type ConversationTurn,
} from '@/lib/ai/ask-conversation';
import InlineFeedback from '@/components/InlineFeedback';
import { Skeleton } from '@/components/Skeleton';

interface AgentAction {
  type: 'update_segment' | 'delete_segment' | 'create_segment' | 'update_document';
  segmentId?: string;
  documentId?: string;
  afterIndex?: number;
  title?: string;
  content?: string;
  tags?: string[];
  current?: { title?: string; tags?: string[]; contentPreview?: string };
}

interface ActionState {
  action: AgentAction;
  status: 'pending' | 'applied' | 'error';
  msg?: string;
}

/** 预设快捷问题：对话起步（v15 起不再带 advice 标记，由 Agent 自主决策） */
const PRESETS = ['我下一步学什么？', '我最薄弱的是什么？', '帮我规划本周复习'];

/** 无上下文时的输入框占位（单节点上下文会换成「解释这个知识点」提示，见 inputPlaceholder） */
const DEFAULT_PLACEHOLDER = '例如：把《TCP 与 UDP》的标题改成「传输层对比」';

/**
 * 模型只返回 propose_actions、没有正文时，服务端会补一句兜底文案但不会通过 delta 下发；
 * 这里按同样口径补一条，避免把「有可确认改动」误判成空回答。
 */
const ACTION_ONLY_FALLBACK = '我整理好了改动建议，请在下方确认卡逐项确认。';

/** 当前上下文 chip：id 用于请求体，title 来自 `/api/segments/[id]` */
interface ContextChip {
  id: string;
  title: string;
}

/** 一次 URL 上下文的加载结果：与 `search` 绑定，URL 变化后自动视为未就绪 */
interface ContextLoad {
  search: string;
  chips: ContextChip[];
  /** 拉取失败的知识点数量（UX-08：不再静默剔除，界面要提示 N 个未能带入） */
  failed: number;
  kind: AskContextKind;
  /**
   * 本地移除/清空 chip 时置 true：地址栏用 history.replaceState 同步，
   * Next 的 useSearchParams 不会立刻更新；此时以本地状态为准，避免永久骨架。
   */
  local?: boolean;
}

/** 原生 fetch 的 401 出口：与 api() 一致地跳登录页并回跳当前地址（SSE 不能走 api()） */
function redirectToLoginIfUnauthorized(res: Response): void {
  if (res.status !== 401 || typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname.startsWith('/login/')) return;
  window.location.replace(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`);
}

/** useSearchParams 属于运行时 URL 数据，必须包在 Suspense 内（cacheComponents 静态预渲染要求） */
export default function AskPage() {
  return (
    <Suspense fallback={<AskPageFallback />}>
      <AskPageContent />
    </Suspense>
  );
}

/** 大模型配置读取状态：区分「还在读」「读到了」「读失败」（FE-008） */
type ConfigState = 'loading' | 'ready' | 'failed';

/** 知识库助手：常驻上下文 + 自主检索 + 管理提议确认卡；多轮对话（客户端保存历史） */
function AskPageContent() {
  const [configState, setConfigState] = useState<ConfigState>('loading');
  /** 服务端明确返回的「是否已配置」；只有在 configState==='ready' 时才可信 */
  const [configured, setConfigured] = useState(false);
  /** 配置读取失败原因（FE-008）：不能与「确实没配置」混为一谈 */
  const [configError, setConfigError] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  /** 当前这一轮：流式中或刚失败；成功后并入 history（不再用单个 result 覆盖） */
  const [turn, setTurn] = useState<ConversationTurn | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [actions, setActions] = useState<ActionState[] | null>(null);
  const [applying, setApplying] = useState(false);
  /** 本轮提问的失败原因（非 401）：渲染错误卡 +「重试」，输入框内容保留 */
  const [turnError, setTurnError] = useState('');
  /** 有内容但没收到 done：提示回答可能被截断 */
  const [streamNote, setStreamNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const parsedContext = useMemo(() => parseAskContext(new URLSearchParams(search)), [search]);
  const [contextLoad, setContextLoad] = useState<ContextLoad | null>(null);
  /** 建议问题只在首次带入 path 时预填一次；之后（含移除 chip 触发的重载）不再覆盖输入框 */
  const suggestedRef = useRef(false);
  /** 只有加载结果对应当前 URL（或本地移除/清空后的覆盖）时才算就绪 */
  const contextReady = contextLoad !== null && (contextLoad.search === search || contextLoad.local === true);
  const contextChips = contextReady ? contextLoad.chips : [];
  const contextFailed = contextReady ? contextLoad.failed : 0;
  const contextKind: AskContextKind = contextReady ? contextLoad.kind : parsedContext.kind;
  const contextLoading = parsedContext.segmentIds.length > 0 && !contextReady;
  /** 消息列表 = 已完成历史 + 当前这一轮；连续 3 轮提问后 3 问 3 答都在屏（UX-06） */
  const messages = useMemo(() => buildConversationMessages(history, turn), [history, turn]);
  const pendingApplyIndexes = useMemo(() => (actions ? pendingActionIndexes(actions) : []), [actions]);
  const retryApplyIndexes = useMemo(() => (actions ? retryableActionIndexes(actions) : []), [actions]);
  const appliedCount = actions ? actions.filter((item) => item.status === 'applied').length : 0;

  /**
   * 读取大模型配置（FE-008）。
   * 旧实现把任何失败都当成 configured:false，导致网络抖动时已配置用户被引导去重新配置。
   * 现在区分三态：loading / ready / failed；失败保留原因并提供重试。
   * 仅在服务端明确返回 configured:false 时才展示设置引导。
   * 三个回调拆开写：effect 内只调 api()（异步回调里 setState），避免同步 setState 触发级联渲染。
   */
  const applyConfig = useCallback((c: { configured: boolean }) => {
    setConfigured(c.configured);
    setConfigError('');
    setConfigState('ready');
  }, []);

  const handleConfigError = useCallback((error: unknown) => {
    if (isAuthError(error)) return;
    setConfigError(error instanceof Error ? error.message : '配置读取失败');
    setConfigState('failed');
  }, []);

  /** 失败后的重试入口（事件处理器，可以同步改状态） */
  const reloadConfig = useCallback(() => {
    setConfigState('loading');
    setConfigError('');
    api<{ configured: boolean }>('/api/ai/config').then(applyConfig).catch(handleConfigError);
  }, [applyConfig, handleConfigError]);

  useEffect(() => {
    api<{ configured: boolean }>('/api/ai/config').then(applyConfig).catch(handleConfigError);
  }, [applyConfig, handleConfigError]);

  /**
   * URL 上下文 → 标题 chips（U4-4）：
   * 只对合法 UUID 并行取 `GET /api/segments/[id]`；成功带入的照常使用，失败的数量记录在
   * `failed` 里，由页面显示「N 个知识点未能带入」警告（UX-08 不再静默剔除）。
   * 有 path（≥2 个有效节点）时把建议问题预填进输入框，但绝不自动发送。
   * 仅在异步回调里 setState（不在 effect 同步段触发级联渲染）。
   */
  useEffect(() => {
    if (parsedContext.segmentIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      parsedContext.segmentIds.map(async (id): Promise<ContextChip | null> => {
        try {
          const data = await api<{ segment: { title: string } }>(`/api/segments/${id}`);
          return { id, title: data.segment.title };
        } catch {
          return null;
        }
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        const chips = rows.filter((row): row is ContextChip => Boolean(row));
        const failed = rows.length - chips.length;
        setContextLoad({
          search,
          chips,
          failed,
          kind: chips.length > 1 ? 'path' : chips.length === 1 ? 'segment' : 'none',
        });
        if (chips.length > 1 && !suggestedRef.current) {
          suggestedRef.current = true;
          setQuery((current) => (current.trim() ? current : buildSuggestQuestion('path')));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContextLoad({ search, chips: [], failed: parsedContext.segmentIds.length, kind: 'none' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [search, parsedContext]);

  /**
   * 只改地址栏（history.replaceState）：不动 Next 路由、不重新加载页面、不重新发问。
   * 返回改写后的 query string —— 与 Next 随后得到的 `useSearchParams()` 值一致，
   * 让 chips 的本地状态在 URL 收敛前就视为「已就绪」，避免移除 chip 时闪一下骨架。
   */
  const syncContextUrl = (ids: string[]): string => {
    if (typeof window === 'undefined') return search;
    const url = new URL(window.location.href);
    url.searchParams.delete(ASK_CONTEXT_PARAM_SEGMENT);
    url.searchParams.delete(ASK_CONTEXT_PARAM_PATH);
    if (ids.length === 1) url.searchParams.set(ASK_CONTEXT_PARAM_SEGMENT, ids[0]);
    else if (ids.length > 1) url.searchParams.set(ASK_CONTEXT_PARAM_PATH, ids.join(','));
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return url.searchParams.toString();
  };

  const removeContextChip = (id: string) => {
    const next = contextChips.filter((chip) => chip.id !== id);
    const nextIds = next.map((chip) => chip.id);
    // 用户手动编辑上下文后，之前那次「未能带入」的警告不再代表当前 URL，一并清掉
    setContextLoad({
      search: syncContextUrl(nextIds),
      chips: next,
      failed: 0,
      kind: next.length > 1 ? 'path' : next.length === 1 ? 'segment' : 'none',
      local: true,
    });
  };

  const clearContext = () => {
    setContextLoad({ search: syncContextUrl([]), chips: [], failed: 0, kind: 'none', local: true });
  };

  const inputPlaceholder = contextKind === 'segment' ? `例如：${ASK_SEGMENT_SUGGESTION}` : DEFAULT_PLACEHOLDER;

  /** 一轮问答成功：成对写入历史、清空当前轮与输入框（失败分支绝不调用） */
  const commitTurn = (question: string, answer: string, sources: ConversationSource[]) => {
    setHistory((prev) => appendTurn(prev, { question, answer, sources }));
    setTurn(null);
    setQuery('');
  };

  const ask = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q || busy) return;
    setBusy(true);
    setTurnError('');
    setStreamNote('');
    setActions(null);
    setStatus('');
    setTurn({ question: q, answer: '', streaming: true });
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAskRequestBody(q, history, contextChips.map((chip) => chip.id))),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        redirectToLoginIfUnauthorized(res);
        throw new ApiError(d.error ?? `请求失败（${res.status}）`, res.status);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let acc = '';
        let donePayload: { sources?: ConversationSource[]; actions?: AgentAction[] } | null = null;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith('data:')) continue;
              let payload: {
                delta?: string;
                status?: string;
                done?: boolean;
                sources?: ConversationSource[];
                actions?: AgentAction[];
                mode?: string;
                error?: string;
              };
              try {
                payload = JSON.parse(line.slice(5).trim());
              } catch {
                continue;
              }
              if (payload.error) throw new Error(payload.error);
              if (payload.done) {
                donePayload = payload;
              } else if (typeof payload.status === 'string') {
                setStatus(payload.status);
              } else if (typeof payload.delta === 'string' && payload.delta) {
                acc += payload.delta;
                setStatus('');
                setTurn({ question: q, answer: acc, streaming: true });
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        // UX-07：没有 done 也没有任何内容 → 错误态并保留输入内容，不再停在空的 streaming
        const finish = resolveStreamFinish({ done: donePayload !== null, answer: acc });
        if (finish === 'empty') {
          if (!donePayload?.actions?.length) throw new Error(EMPTY_STREAM_MESSAGE);
          // 只有改动提议、模型没写正文：服务端兜底文案不经 delta 下发，这里按同口径补一条
          acc = ACTION_ONLY_FALLBACK;
        }
        const sources = donePayload?.sources ?? [];
        commitTurn(q, acc, sources);
        if (finish === 'partial') setStreamNote(PARTIAL_STREAM_NOTE);
        if (donePayload?.actions?.length) {
          setActions(donePayload.actions.map((action) => ({ action, status: 'pending' as const })));
        }
      } else {
        // 非流式 JSON（空库早退引导等）
        const r = (await res.json()) as { answer: string; sources?: ConversationSource[] };
        if (!r.answer?.trim()) throw new Error(EMPTY_STREAM_MESSAGE);
        commitTurn(q, r.answer, r.sources ?? []);
      }
    } catch (e) {
      // 无论成功失败都先把流式光标收起来；失败时保留这一轮的用户问题
      setTurn((current) => (current ? { ...current, streaming: false } : current));
      if (isAuthError(e)) {
        // api()/redirectToLoginIfUnauthorized 已跳转登录页：只停 loading，不显示「请求失败（401）」
        setTurn(null);
      } else {
        setTurnError(e instanceof Error ? e.message : '提问失败');
      }
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const newChat = () => {
    setHistory([]);
    setTurn(null);
    setTurnError('');
    setStreamNote('');
    setActions(null);
    setQuery('');
    inputRef.current?.focus();
  };

  /** 逐项应用：走既有 v10 端点（确认闸门在前端，服务端 chat 链路零写库） */
  const applyActions = async (indexes: number[]) => {
    if (!actions || applying) return;
    const targets = indexes.filter(
      (index) => index >= 0 && index < actions.length && actions[index].status !== 'applied',
    );
    if (targets.length === 0) return;
    setApplying(true);
    const next = [...actions];
    try {
      for (const index of targets) {
        try {
          await sendAgentAction(next[index].action);
          next[index] = { ...next[index], status: 'applied', msg: undefined };
        } catch (e) {
          next[index] = {
            ...next[index],
            status: 'error',
            msg: isAuthError(e) ? '登录已过期，请重新登录' : e instanceof Error ? e.message : '应用失败',
          };
        }
        setActions([...next]);
      }
    } finally {
      setApplying(false);
    }
  };

  const retryQuestion = turn?.question ?? '';

  return (
    <div className="mx-auto max-w-reading space-y-4">
      <div className="fade-up flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-title font-semibold">助手</h1>
          <p className="mt-1.5 text-minor text-muted">
            了解你的知识库与学习进度：可以问答、查细节、也能帮你改标题、整理段落（每一步都会先给你确认）。
          </p>
        </div>
        {(history.length > 0 || turn) && (
          <button
            onClick={newChat}
            disabled={busy}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line px-3 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            新对话
          </button>
        )}
      </div>

      {contextLoading && contextChips.length === 0 && (
        <section
          className="card fade-up px-4 py-3"
          style={{ animationDelay: '20ms' }}
          role="status"
          aria-label="当前上下文加载中"
        >
          <p className="text-tag uppercase text-faint">当前上下文</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-36 rounded-full" />
          </div>
        </section>
      )}

      {contextChips.length > 0 && (
        <section className="card fade-up px-4 py-3" style={{ animationDelay: '20ms' }} aria-label="当前上下文">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-tag uppercase text-faint">
              当前上下文{contextKind === 'path' ? ` · ${contextChips.length} 个知识点` : ' · 1 个知识点'}
            </p>
            <button
              type="button"
              onClick={clearContext}
              className="rounded-md px-1.5 py-0.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              全部清除
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {contextChips.map((chip) => (
              <li
                key={chip.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-tag text-muted"
              >
                <span className="truncate" title={chip.title}>
                  {chip.title}
                </span>
                <button
                  type="button"
                  onClick={() => removeContextChip(chip.id)}
                  aria-label={`移除上下文《${chip.title}》`}
                  className="shrink-0 rounded-full px-1 text-faint transition-colors duration-150 hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-tag text-faint">
            {contextKind === 'path'
              ? '已带入路径上的知识点，发送前可继续修改问题。'
              : '已带入该知识点，发送前可继续修改问题。'}
          </p>
          {contextFailed > 0 && (
            <InlineFeedback tone="warn" className="mt-2">
              有 {contextFailed} 个知识点未能带入（可能已被删除或无权访问），本轮回答不会包含它们。
            </InlineFeedback>
          )}
        </section>
      )}

      {contextReady && contextChips.length === 0 && contextFailed > 0 && (
        <section className="card fade-up px-4 py-3" style={{ animationDelay: '20ms' }} aria-label="当前上下文">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-tag uppercase text-faint">当前上下文</p>
            <button
              type="button"
              onClick={clearContext}
              className="rounded-md px-1.5 py-0.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              清除上下文
            </button>
          </div>
          <InlineFeedback tone="warn" className="mt-2">
            有 {contextFailed} 个知识点未能带入（可能已被删除或无权访问），本轮回答不会包含它们。
          </InlineFeedback>
        </section>
      )}

      {configState === 'ready' && !configured ? (
        <div className="card fade-up px-5 py-6" style={{ animationDelay: '80ms' }}>
          <p className="font-display text-card text-primary">还没有配置大模型。</p>
          <p className="mt-1.5 text-minor text-muted">到设置页填写 DeepSeek API Key 后即可开始对话，配置即存即用。</p>
          <Link
            href="/settings"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
          >
            去设置
          </Link>
        </div>
      ) : (
        <>
          {/* FE-008：配置读取失败 ≠ 未配置。给错误 + 重试，而不是把用户送去设置页。 */}
          {configState === 'failed' && (
            <div className="card fade-up border-danger/30 px-5 py-4" role="alert">
              <p className="text-tag uppercase text-faint">无法读取大模型配置</p>
              <p className="mt-1.5 text-minor text-danger">{configError}</p>
              <p className="mt-1 text-tag leading-relaxed text-faint">
                这不代表还没有配置大模型，更可能是网络或服务暂时不可用。恢复后重试即可继续对话。
              </p>
              <button
                type="button"
                onClick={() => reloadConfig()}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
              >
                重试
              </button>
            </div>
          )}
          <div className="fade-up flex flex-wrap gap-1.5" style={{ animationDelay: '40ms' }}>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setQuery(p);
                  inputRef.current?.focus();
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3 py-1 text-tag text-muted transition-colors duration-150 hover:border-accent/50 hover:text-accent"
              >
                {p}
              </button>
            ))}
          </div>
          <form
            className="fade-up flex gap-2"
            style={{ animationDelay: '40ms' }}
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={inputPlaceholder}
              // 配置读取失败时禁用输入区：此时提问必然失败，先让用户重试配置（FE-008）
              disabled={configState === 'failed'}
              // 浏览器/开发工具会在水合前给聚焦输入框注入 caret-color 内联样式（不影响值与交互）
              suppressHydrationWarning
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !query.trim() || configState === 'failed'}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? status || '思考中…' : '发送'}
            </button>
          </form>

          {configState === 'failed' && (
            <p className="px-1 text-tag text-faint">配置读取失败，暂时无法提问——请先重试上面的配置读取。</p>
          )}

          {messages.length > 0 && (
            <section className="fade-up space-y-3" aria-label="对话记录">
              {messages.map((message, index) => (
                <MessageBubble
                  key={index}
                  message={message}
                  status={message.streaming && index === messages.length - 1 ? status : ''}
                />
              ))}
            </section>
          )}

          {streamNote && <InlineFeedback tone="warn">{streamNote}</InlineFeedback>}

          {turnError && (
            <div className="card fade-up border-danger/30 px-5 py-4" role="alert">
              <p className="text-tag uppercase text-faint">本轮提问失败</p>
              <InlineFeedback tone="danger" className="mt-1.5">
                {turnError}
              </InlineFeedback>
              <p className="mt-1 text-tag text-faint">输入框内容已保留，可直接修改后重发，或点「重试」重新提问。</p>
              <button
                type="button"
                onClick={() => {
                  if (retryQuestion) ask(retryQuestion);
                }}
                disabled={busy || !retryQuestion}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-3.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                重试
              </button>
            </div>
          )}

          {actions && actions.length > 0 && (
            <section className="card fade-up border-warn/30 px-5 py-4" aria-label="改动确认">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-tag uppercase text-faint">
                  改动确认（{appliedCount}/{actions.length} 已应用）
                </p>
                <div className="flex gap-2">
                  {canApplyActions(actions) ? (
                    <button
                      onClick={() => {
                        // 有 pending 时应用 pending；全部失败时退化为「全部重试」（按钮不永久消失）
                        applyActions(pendingApplyIndexes.length > 0 ? pendingApplyIndexes : retryApplyIndexes);
                      }}
                      disabled={applying}
                      className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
                    >
                      {applying ? '应用中…' : pendingApplyIndexes.length > 0 ? '应用' : '全部重试'}
                    </button>
                  ) : null}
                  <button
                    onClick={() => setActions(null)}
                    disabled={applying}
                    className="inline-flex min-h-11 items-center rounded-lg border border-line px-3.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
                  >
                    {pendingApplyIndexes.length > 0 ? '忽略' : '关闭'}
                  </button>
                </div>
              </div>
              <ul className="mt-3 space-y-2.5">
                {actions.map((s, i) => (
                  <li key={i} className="rounded-lg border border-line bg-app/60 px-3 py-2.5 text-minor">
                    <ActionDetail action={s.action} />
                    {s.status === 'applied' && <p className="mt-1.5 text-tag text-success">✓ 已应用</p>}
                    {isActionRetryable(s) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <InlineFeedback tone="danger">✗ {s.msg ?? '应用失败'}</InlineFeedback>
                        <button
                          type="button"
                          onClick={() => applyActions([i])}
                          disabled={applying}
                          className="shrink-0 rounded-md border border-line px-2 py-0.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
                        >
                          重试
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {messages.length === 0 && !busy && !turnError && (
            <p className="fade-up px-1 text-tag text-faint" style={{ animationDelay: '120ms' }}>
              {history.length > 0
                ? `对话中 · 已记住最近 ${history.length} 条（上限 ${HISTORY_LIMIT}）`
                : '可以直接问，也可以让它改标题、拆段落——改动前都会先经你确认。'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Suspense 兜底：与真实页头同形的轻骨架，URL 参数就绪前不阻塞首屏 */
function AskPageFallback() {
  return (
    <div className="mx-auto max-w-reading space-y-4">
      <div>
        <h1 className="font-display text-title font-semibold">助手</h1>
        <p className="mt-1.5 text-minor text-muted">
          了解你的知识库与学习进度：可以问答、查细节、也能帮你改标题、整理段落（每一步都会先给你确认）。
        </p>
      </div>
      <div className="card px-5 py-4" role="status" aria-label="页面加载中">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-3 h-4 w-full" />
      </div>
    </div>
  );
}

/** 单条消息：用户问题右对齐气泡，助手回答左对齐卡片（Markdown + 来源 + 流式光标） */
function MessageBubble({ message, status = '' }: { message: ConversationMessage; status?: string }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent/10 px-4 py-2.5">
          <p className="text-tag text-faint">你</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-primary">{message.content}</p>
        </div>
      </div>
    );
  }
  const streaming = message.streaming === true;
  return (
    <section className="card px-5 py-4" aria-label="助手回答">
      {message.content ? (
        <div className="md-body text-body">
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent/70 align-middle" aria-label="生成中" />
          )}
        </div>
      ) : (
        <div role="status" aria-label="回答生成中">
          {status ? (
            <p className="text-minor text-muted">
              <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />
              {status}
            </p>
          ) : (
            <>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-3 h-4 w-5/6" />
            </>
          )}
        </div>
      )}
      {!streaming && message.sources && message.sources.length > 0 && <SourcesBlock sources={message.sources} />}
    </section>
  );
}

/** 来源列表：仅在该轮回答结束后展示（流式中不展示不完整来源） */
function SourcesBlock({ sources }: { sources: ConversationSource[] }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-tag uppercase text-faint">来源（{sources.length}）</p>
      <ul className="mt-2 space-y-1.5">
        {sources.map((s, i) => (
          <li key={`${s.segmentId}-${i}`}>
            <Link
              href={`/segments/${s.segmentId}`}
              className="group flex min-w-0 items-center gap-2 text-minor text-muted transition-colors duration-150 hover:text-accent"
            >
              <span className="shrink-0 font-mono text-tag tabular-nums text-faint">[{i + 1}]</span>
              <span className="truncate group-hover:underline">{s.title}</span>
              <span className="shrink-0 text-tag text-faint group-hover:text-accent">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 确认卡单项：类型 + 目标 + 改动前后对照（delete 红色警示） */
function ActionDetail({ action }: { action: AgentAction }) {
  const cur = action.current;
  if (action.type === 'delete_segment') {
    return (
      <p>
        <span className="mr-2 rounded bg-danger/15 px-1.5 py-0.5 text-tag font-medium text-danger">删除知识点</span>
        《{cur?.title ?? action.segmentId}》
        <span className="ml-2 text-tag text-danger">不可恢复，请确认</span>
      </p>
    );
  }
  if (action.type === 'update_segment') {
    return (
      <div className="space-y-1">
        <p>
          <span className="mr-2 rounded bg-accent/15 px-1.5 py-0.5 text-tag font-medium text-accent">修改知识点</span>
          《{cur?.title ?? action.segmentId}》
        </p>
        {action.title && <p className="text-tag text-muted">标题：{cur?.title ?? '—'} <span className="text-faint">→</span> <span className="text-primary">{action.title}</span></p>}
        {action.content && (
          <p className="text-tag text-muted">
            内容：{cur?.contentPreview ?? '（空）'}… <span className="text-faint">→</span> 新内容 {action.content.length} 字
          </p>
        )}
        {action.tags && <p className="text-tag text-muted">标签：{(cur?.tags ?? []).join(' ') || '—'} <span className="text-faint">→</span> {action.tags.map((t) => `#${t}`).join(' ')}</p>}
      </div>
    );
  }
  if (action.type === 'create_segment') {
    return (
      <div className="space-y-1">
        <p>
          <span className="mr-2 rounded bg-success/15 px-1.5 py-0.5 text-tag font-medium text-success">插入知识点</span>
          到《{cur?.title ?? action.documentId}》{typeof action.afterIndex === 'number' ? `第 ${action.afterIndex + 1} 位` : '末尾'}
        </p>
        <p className="text-tag text-muted">《{action.title}》 新内容 {action.content?.length ?? 0} 字</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p>
        <span className="mr-2 rounded bg-accent/15 px-1.5 py-0.5 text-tag font-medium text-accent">修改文档</span>
        《{cur?.title ?? action.documentId}》
      </p>
      {action.title && <p className="text-tag text-muted">标题：{cur?.title ?? '—'} <span className="text-faint">→</span> <span className="text-primary">{action.title}</span></p>}
      {action.tags && <p className="text-tag text-muted">标签：{(cur?.tags ?? []).join(' ') || '—'} <span className="text-faint">→</span> {action.tags.map((t) => `#${t}`).join(' ')}</p>}
    </div>
  );
}

/**
 * 执行单条改动提议：走既有 v10 端点（服务端 chat 链路零写库，确认闸门在前端）。
 * 用原生 fetch 以便逐条标注状态；401 时与 api() 一致地跳登录页。
 */
async function sendAgentAction(a: AgentAction): Promise<void> {
  let res: Response;
  if (a.type === 'update_segment') {
    res = await fetch(`/api/segments/${a.segmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: a.title, content: a.content, tags: a.tags }),
    });
  } else if (a.type === 'delete_segment') {
    res = await fetch(`/api/segments/${a.segmentId}`, { method: 'DELETE' });
  } else if (a.type === 'create_segment') {
    res = await fetch(`/api/notes/${a.documentId}/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afterIndex: a.afterIndex, title: a.title, content: a.content }),
    });
  } else {
    res = await fetch(`/api/notes/${a.documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: a.title, tags: a.tags }),
    });
  }
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    redirectToLoginIfUnauthorized(res);
    throw new ApiError(d.error ?? `HTTP ${res.status}`, res.status);
  }
}
