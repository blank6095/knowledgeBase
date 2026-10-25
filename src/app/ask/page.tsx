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

interface AskResult {
  answer: string;
  sources: Source[];
}

/** 问知识库：RAG 检索 top6 注入材料，仅基于材料作答并附来源跳转 */
export default function AskPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>('/api/ai/config')
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
  }, []);

  const ask = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await api<AskResult>('/api/ai/ask', { method: 'POST', body: JSON.stringify({ query: q }) });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提问失败');
    } finally {
      setBusy(false);
    }
  };

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

          {busy && (
            <div className="card fade-up px-5 py-4" role="status" aria-label="回答生成中">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-3 h-4 w-5/6" />
            </div>
          )}
          {error && <p className="text-minor text-danger">{error}</p>}

          {result && (
            <section className="card fade-up px-5 py-4">
              <div className="md-body text-body">
                <Markdown remarkPlugins={[remarkGfm]}>{result.answer}</Markdown>
              </div>
              {result.sources.length > 0 && (
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
