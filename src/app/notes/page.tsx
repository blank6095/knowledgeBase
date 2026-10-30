'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import MemoryBadge from '@/components/MemoryBadge';
import { Skeleton } from '@/components/Skeleton';
import ErrorState from '@/components/ErrorState';

interface DocRow {
  id: string;
  title: string;
  source: string;
  tags: string[];
  segmentCount: number;
  createdAt: string;
  avgMemory: number;
}

export default function NotesPage() {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  // 重试令牌：失败后不刷新整页也能重新拉取（数据库抖动时的主要恢复手段）
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ documents: DocRow[] }>('/api/notes')
      .then((d) => {
        if (!alive) return;
        setDocs(d.documents);
        setError('');
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const kw = q.trim().toLowerCase();
    if (!kw) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(kw) || d.tags.some((t) => t.toLowerCase().includes(kw)));
  }, [docs, q]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState
          message={error}
          onRetry={() => setReloadToken((n) => n + 1)}
          hint="若提示数据库暂时不可用，稍后点「重试」即可；期间可以先到「学习复盘」查看已缓存的学习数据。"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="fade-up flex flex-wrap items-center gap-3">
        <h1 className="font-display text-title font-semibold">知识库</h1>
        <span className="font-mono text-tag tabular-nums text-faint">{docs ? `${docs.length} 篇文档` : ''}</span>
        <div className="flex-1" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索标题或标签…"
          className="w-48 rounded-lg border border-line bg-surface px-3 py-1.5 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
        />
        <Link
          href="/import"
          className="rounded-lg bg-accent px-3.5 py-1.5 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
        >
          导入
        </Link>
      </div>

      {!docs ? (
        <div className="space-y-2" role="status" aria-label="加载中">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="card flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card fade-up px-6 py-12 text-center">
          {docs.length === 0 ? (
            <>
              <p className="font-display text-subtitle text-primary">书房还空着，等第一份手稿。</p>
              <p className="mt-2 text-minor text-muted">导入一篇 Markdown，它会自动拆成知识点、建好关联，等着被点亮。</p>
              <Link
                href="/import"
                className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
              >
                导入第一篇
              </Link>
            </>
          ) : (
            <p className="text-minor text-muted">没有匹配的文档。</p>
          )}
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {filtered.map((d, i) => (
            <li key={d.id} className="fade-up" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
              <Link
                href={`/notes/${d.id}`}
                className="group flex flex-col gap-1.5 px-4 py-3 transition-colors duration-150 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="truncate font-display text-card text-primary transition-colors duration-150 group-hover:text-accent-strong">
                    {d.title}
                  </span>
                  {d.tags.length > 0 && (
                    <span className="ml-2 hidden space-x-1.5 sm:inline">
                      {d.tags.slice(0, 4).map((t) => (
                        <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-tag text-muted">
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                {/* mono 元数据列 + 记忆灯点 */}
                <div className="flex shrink-0 items-center gap-3 font-mono text-tag tabular-nums text-muted">
                  <MemoryBadge memory={d.avgMemory ?? 0} />
                  <span className="w-10 whitespace-nowrap text-right">{d.segmentCount} 点</span>
                  <span className="whitespace-nowrap">{formatDate(d.createdAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
