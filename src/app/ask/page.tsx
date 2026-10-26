'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/client';
import { Skeleton } from '@/components/Skeleton';

interface Source {
  segmentId: string;
  title: string;
}

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

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

interface AskResult {
  answer: string;
  sources: Source[];
  streaming?: boolean;
  mode?: string;
}

/** 预设快捷问题：对话起步（v15 起不再带 advice 标记，由 Agent 自主决策） */
const PRESETS = ['我下一步学什么？', '我最薄弱的是什么？', '帮我规划本周复习'];

const HISTORY_LIMIT = 10;

/** 知识库助手：常驻上下文 + 自主检索 + 管理提议确认卡；多轮对话（客户端保存历史） */
export default function AskPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [actions, setActions] = useState<ActionState[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>('/api/ai/config')
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
  }, []);

  const ask = async (text?: string) => {
    const q = (text ?? query).trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setActions(null);
    setStatus('');
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, history }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `请求失败（${res.status}）`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream') && res.body) {
        setResult({ answer: '', sources: [], streaming: true });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let acc = '';
        let donePayload: { sources?: Source[]; actions?: AgentAction[]; mode?: string } | null = null;
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
              sources?: Source[];
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
              setResult({ answer: acc, sources: [], streaming: true });
            }
          }
        }
        if (donePayload) {
          setResult({ answer: acc, sources: donePayload.sources ?? [], mode: donePayload.mode });
          if (donePayload.actions?.length) {
            setActions(donePayload.actions.map((action) => ({ action, status: 'pending' as const })));
          }
          const round: ChatMsg[] = [...history, { role: 'user', content: q }, { role: 'assistant', content: acc }];
          setHistory(round.slice(-HISTORY_LIMIT));
        } else if (acc) {
          setResult({ answer: acc, sources: [] });
          const round: ChatMsg[] = [...history, { role: 'user', content: q }, { role: 'assistant', content: acc }];
          setHistory(round.slice(-HISTORY_LIMIT));
        }
      } else {
        // 非流式 JSON（空库早退引导等）
        const r = (await res.json()) as AskResult;
        setResult(r);
      }
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '提问失败');
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const newChat = () => {
    setHistory([]);
    setResult(null);
    setActions(null);
    setError('');
    setQuery('');
    inputRef.current?.focus();
  };

  /** 逐项应用：走既有 v10 端点（确认闸门在前端，服务端 chat 链路零写库） */
  const applyActions = async () => {
    if (!actions || applying) return;
    setApplying(true);
    const next = [...actions];
    for (let i = 0; i < next.length; i++) {
      if (next[i].status !== 'pending') continue;
      const a = next[i].action;
      try {
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
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        next[i] = { ...next[i], status: 'applied' };
      } catch (e) {
        next[i] = { ...next[i], status: 'error', msg: e instanceof Error ? e.message : '应用失败' };
      }
      setActions([...next]);
    }
    setApplying(false);
  };

  return (
    <div className="mx-auto max-w-[42rem] space-y-4">
      <div className="fade-up flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-title font-semibold">助手</h1>
          <p className="mt-1.5 text-minor text-muted">
            了解你的知识库与学习进度：可以问答、查细节、也能帮你改标题、整理段落（每一步都会先给你确认）。
          </p>
        </div>
        {(history.length > 0 || result) && (
          <button
            onClick={newChat}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
          >
            新对话
          </button>
        )}
      </div>

      {configured === false ? (
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
          <div className="fade-up flex flex-wrap gap-1.5" style={{ animationDelay: '40ms' }}>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setQuery(p);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-line bg-surface px-3 py-1 text-tag text-muted transition-colors duration-150 hover:border-accent/50 hover:text-accent"
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
              placeholder="例如：把《TCP 与 UDP》的标题改成「传输层对比」"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !query.trim()}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? status || '思考中…' : '发送'}
            </button>
          </form>

          {busy && (!result || !result.answer) && (
            <div className="card fade-up px-5 py-4" role="status" aria-label="回答生成中">
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
          {error && <p className="text-minor text-danger">{error}</p>}

          {result && result.answer && (
            <section className="card fade-up px-5 py-4">
              <div className="md-body text-body">
                <Markdown remarkPlugins={[remarkGfm]}>{result.answer}</Markdown>
                {result.streaming && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent/70 align-middle" aria-label="生成中" />}
              </div>
              {!result.streaming && result.sources.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-tag uppercase text-faint">来源（{result.sources.length}）</p>
                  <ul className="mt-2 space-y-1.5">
                    {result.sources.map((s, i) => (
                      <li key={s.segmentId}>
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
              )}
            </section>
          )}

          {actions && actions.length > 0 && (
            <section className="card fade-up border-warn/30 px-5 py-4" aria-label="改动确认">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-tag uppercase text-faint">改动确认（{actions.filter((a) => a.status === 'applied').length}/{actions.length} 已应用）</p>
                <div className="flex gap-2">
                  {actions.some((a) => a.status === 'pending') ? (
                    <button
                      onClick={applyActions}
                      disabled={applying}
                      className="rounded-lg bg-accent px-3.5 py-1.5 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
                    >
                      {applying ? '应用中…' : '应用'}
                    </button>
                  ) : null}
                  <button
                    onClick={() => setActions(null)}
                    disabled={applying}
                    className="rounded-lg border border-line px-3.5 py-1.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary disabled:opacity-50"
                  >
                    {actions.every((a) => a.status !== 'pending') ? '关闭' : '忽略'}
                  </button>
                </div>
              </div>
              <ul className="mt-3 space-y-2.5">
                {actions.map((s, i) => (
                  <li key={i} className="rounded-lg border border-line bg-app/60 px-3 py-2.5 text-minor">
                    <ActionDetail action={s.action} />
                    {s.status === 'applied' && <p className="mt-1.5 text-tag text-success">✓ 已应用</p>}
                    {s.status === 'error' && <p className="mt-1.5 text-tag text-danger">✗ {s.msg}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!result && !busy && !error && (
            <p className="fade-up px-1 text-tag text-faint" style={{ animationDelay: '120ms' }}>
              {history.length > 0 ? `对话中 · 已记住最近 ${history.length} 条（上限 10）` : '可以直接问，也可以让它改标题、拆段落——改动前都会先经你确认。'}
            </p>
          )}
        </>
      )}
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
