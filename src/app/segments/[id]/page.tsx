'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatDate, formatDuration } from '@/lib/client';
import MemoryBadge from '@/components/MemoryBadge';
import { memoryColor } from '@/lib/memory';
import { Skeleton } from '@/components/Skeleton';

interface SegmentDetail {
  segment: {
    id: string;
    title: string;
    content: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    stability: number;
    readingMs: number;
    memory: number;
    halfLifeDays: number;
  };
  document: { id: string; title: string } | null;
  neighbors: { id: string; title: string; memory: number }[];
}

/** 停留时长会话：随组件实例存续，跨 StrictMode 二次挂载与同页参数切换保持 */
interface ReadingSession {
  id: string;
  counted: boolean;
  since: number | null; // 当前可见段起点，null=页面隐藏中
  dwell: number; // 尚未上报的累计毫秒
}

/** SPA 内导航卸载时冲刷的最小时长，低于它视为误触（也过滤 StrictMode 同步二次挂载） */
const MIN_FLUSH_MS = 250;

export default function SegmentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SegmentDetail | null>(null);
  const [error, setError] = useState('');
  const session = useRef<ReadingSession>({ id: '', counted: false, since: null, dwell: 0 });

  useEffect(() => {
    api<SegmentDetail>(`/api/segments/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  // 阅读行为采集：打开 ping 计一次查看；可见时计时，隐藏/卸载/离开时上报停留时长
  useEffect(() => {
    const sess = session.current;
    if (sess.id !== id) {
      sess.id = id;
      sess.counted = false;
      sess.since = Date.now();
      sess.dwell = 0;
    }
    if (!sess.counted) {
      sess.counted = true;
      fetch(`/api/segments/${id}/view`, { method: 'POST' }).catch(() => {});
    }

    const pendingMs = () => (sess.since !== null ? Date.now() - sess.since : 0) + sess.dwell;
    const flush = (allowBeacon: boolean) => {
      const durationMs = Math.round(pendingMs());
      sess.dwell = 0;
      sess.since = document.visibilityState === 'visible' ? Date.now() : null;
      if (durationMs <= 0) return;
      const body = JSON.stringify({ durationMs });
      if (allowBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(`/api/segments/${id}/view`, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(`/api/segments/${id}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
      else sess.since = Date.now();
    };
    const onPageHide = () => flush(true);
    // bfcache 恢复后计时基线已失效，重新起点
    const onPageShow = () => {
      sess.since = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      if (pendingMs() >= MIN_FLUSH_MS) flush(false);
    };
  }, [id]);

  if (error) return <p className="text-body text-danger">{error}</p>;
  if (!data)
    return (
      <div className="mx-auto max-w-3xl space-y-4" role="status" aria-label="加载中">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <div className="card px-5 py-6">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className={`mb-3 h-4 ${i === 4 ? 'w-1/2' : 'w-full'}`} />
          ))}
        </div>
        <div className="card px-4 py-3">
          <div className="skeleton h-3 w-16" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton h-4 w-20" />
            ))}
          </div>
        </div>
      </div>
    );

  const s = data.segment;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="fade-up">
        <Link
          href={`/notes/${data.document?.id ?? ''}`}
          className="text-tag text-faint transition-colors hover:text-accent hover:underline"
        >
          ← {data.document?.title ?? '文档'}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-subtitle font-semibold">{s.title}</h1>
          <MemoryBadge memory={s.memory} />
        </div>
        {s.headingPath && s.headingPath !== s.title && (
          <p className="mt-1 text-tag text-faint">{s.headingPath}</p>
        )}
        {s.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.tags.map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-tag text-muted">#{t}</span>
            ))}
          </div>
        )}
      </div>

      <article className="card fade-up px-5 py-4" style={{ animationDelay: '80ms' }}>
        <div className="md-body">
          <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
        </div>
      </article>

      <div className="card fade-up px-4 py-3" style={{ animationDelay: '160ms' }}>
        <h2 className="mb-3 text-tag uppercase text-muted">记忆状态</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Row k="记忆度">
            <div className="flex items-center justify-end gap-2">
              <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.round(s.memory * 100)}%`, background: memoryColor(s.memory) }}
                />
              </div>
              <span className="font-mono text-body tabular-nums">{Math.round(s.memory * 100)}%</span>
            </div>
          </Row>
          <Row k="半衰期">
            <span title="记忆曲线稳定度 S×ln2" className="text-minor">
              {s.stability > 0 ? `预计 ${formatHalfLife(s.halfLifeDays)}后忘一半` : '—'}
            </span>
          </Row>
          <Row k="阅读次数">
            <span className="font-mono tabular-nums">{s.viewCount}</span> 次
          </Row>
          <Row k="累计时长">
            <span className="font-mono tabular-nums">{formatDuration(s.readingMs)}</span>
          </Row>
          <Row k="最近阅读">
            <span className="font-mono tabular-nums">{formatDate(s.lastViewedAt)}</span>
          </Row>
        </dl>
      </div>

      {data.neighbors.length > 0 && (
        <section className="card fade-up px-4 py-3" style={{ animationDelay: '240ms' }}>
          <h2 className="mb-2 text-tag uppercase text-muted">相关知识点</h2>
          <ul className="space-y-1.5">
            {data.neighbors.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/segments/${n.id}`}
                  className="group flex items-center justify-between gap-3 text-body transition-colors duration-150 hover:text-accent"
                >
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <MemoryBadge memory={n.memory} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatHalfLife(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} 小时`;
  return `${Math.round(days)} 天`;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-tag text-muted">{k}</dt>
      <dd className="text-right text-body text-primary">{children}</dd>
    </div>
  );
}
