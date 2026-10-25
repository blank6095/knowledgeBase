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

interface LearnerProfileView {
  profile: {
    totalSegments: number;
    tiers: { unread: number; weak: number; medium: number; strong: number };
    weakSpots: { segmentId: string; title: string; memory: number }[];
  } | null;
  declaration: string;
}

interface AskResult {
  answer: string;
  sources: Source[];
  cached?: boolean;
  streaming?: boolean;
}

/** 问知识库：RAG 检索 top6 注入材料，仅基于材料作答并附来源；SSE 流式逐字渲染，缓存命中秒回 */
export default function AskPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [learner, setLearner] = useState<LearnerProfileView | null>(null);
  const [query, setQuery] = useState('');
  /** 预设快捷问题的教练意图：点选时置位，手动改词即清除（服务端再由正则兜底） */
  const [adviceIntent, setAdviceIntent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>('/api/ai/config')
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
    api<LearnerProfileView>('/api/learner-profile')
      .then(setLearner)
      .catch(() => setLearner(null));
  }, []);

  const ask = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, ...(adviceIntent ? { advice: true } : {}) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `请求失败（${res.status}）`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream') && res.body) {
        // 流式：逐字渲染，末包带来源
        setResult({ answer: '', sources: [], streaming: true });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let acc = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            let payload: { delta?: string; done?: boolean; sources?: Source[]; cached?: boolean; error?: string };
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.error) throw new Error(payload.error);
            if (payload.done) {
              setResult({ answer: acc, sources: payload.sources ?? [], cached: payload.cached });
            } else if (typeof payload.delta === 'string' && payload.delta) {
              acc += payload.delta;
              setResult({ answer: acc, sources: [], streaming: true });
            }
          }
        }
      } else {
        // 降级路径：非流式 JSON（如库内无相关材料的早退）
        const r = (await res.json()) as AskResult;
        setResult(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '提问失败');
    } finally {
      setBusy(false);
    }
  };

  const presetChips: { text: string; advice: boolean }[] = [];
  if (learner?.profile && learner.profile.totalSegments > 0) {
    presetChips.push({ text: '我接下来该学点什么？', advice: true });
    const weak = learner.profile.weakSpots[0];
    if (weak) presetChips.push({ text: `帮我梳理《${weak.title}》`, advice: false });
    if (learner.profile.tiers.unread > 0) {
      presetChips.push({ text: `知识库里还有 ${learner.profile.tiers.unread} 篇未读，先看哪个？`, advice: true });
    }
  }

  return (
    <div className="mx-auto max-w-[42rem] space-y-4">
      <div className="fade-up">
        <h1 className="font-display text-title font-semibold">问知识库</h1>
        <p className="mt-1.5 text-minor text-muted">
          用自然语言提问，回答只基于你导入并阅读过的知识节点，并附来源。
        </p>
      </div>

      {configured === false ? (
        <div className="card fade-up px-5 py-6" style={{ animationDelay: '80ms' }}>
          <p className="font-display text-card text-primary">还没有配置大模型。</p>
          <p className="mt-1.5 text-minor text-muted">到设置页填写 DeepSeek API Key 后即可开始问答，配置即存即用。</p>
          <Link
            href="/settings"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
          >
            去设置
          </Link>
        </div>
      ) : (
        <>
          {presetChips.length > 0 && (
            <div className="fade-up flex flex-wrap gap-1.5" style={{ animationDelay: '40ms' }}>
              {presetChips.map((chip) => (
                <button
                  key={chip.text}
                  onClick={() => {
                    setQuery(chip.text);
                    setAdviceIntent(chip.advice);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-tag text-muted transition-colors duration-150 hover:border-accent/50 hover:text-accent"
                >
                  {chip.text}
                </button>
              ))}
            </div>
          )}
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
              onChange={(e) => {
                setQuery(e.target.value);
                setAdviceIntent(false);
              }}
              placeholder="例如：字体布局偏移怎么应对？"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !query.trim()}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? '检索中…' : '提问'}
            </button>
          </form>

          {busy && (!result || !result.answer) && (
            <div className="card fade-up px-5 py-4" role="status" aria-label="回答生成中">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-3 h-4 w-5/6" />
            </div>
          )}
          {error && <p className="text-minor text-danger">{error}</p>}

          {result && result.answer && (
            <section className="card fade-up px-5 py-4">
              {result.cached && (
                <span className="mb-2 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-tag text-accent">缓存命中 · 零调用</span>
              )}
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

          {!result && !busy && !error && (
            <p className="fade-up px-1 text-tag text-faint" style={{ animationDelay: '120ms' }}>
              检索范围：全部知识点的标题、内容与标签（关键词匹配 + 图谱相邻节点）。
            </p>
          )}
        </>
      )}
    </div>
  );
}
