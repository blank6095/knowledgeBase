'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatDuration } from '@/lib/client';
import { MEMORY_TIER_LABELS, memoryTier } from '@/lib/memory';
import { LampDot } from '@/components/MemoryBadge';
import { Skeleton } from '@/components/Skeleton';
import SegmentEditCard from '@/components/SegmentEditCard';

interface RefItem {
  id: string;
  title: string;
  memory: number;
}

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
    summary: string | null;
  };
  document: { id: string; title: string } | null;
  links: { fromId: string; toId: string; kind: string; weight: number }[];
  refs: {
    outgoing: RefItem[];
    incoming: RefItem[];
    prev: RefItem | null;
    next: RefItem | null;
    relatedTags: RefItem[];
  };
}

/** 停留时长会话：随组件实例存续（StrictMode 二次挂载复用）；切换段时随实例卸载冲刷 */
interface ReadingSession {
  id: string;
  counted: boolean;
  since: number | null; // 当前可见段起点，null=页面隐藏中
  dwell: number; // 尚未上报的累计毫秒
}

/** SPA 内导航卸载时冲刷的最小时长，低于它视为误触（也过滤 StrictMode 同步二次挂载） */
const MIN_FLUSH_MS = 250;

interface LinkGroup {
  key: string;
  title: string;
  hint: string | null;
  items: RefItem[];
}

export default function SegmentPage() {
  const { id } = useParams<{ id: string }>();
  // 以段 id 作 key：切换上一节/下一节时整页重挂，编辑态与草稿状态不会残留到下一个段。
  return <SegmentPageView key={id} id={id} />;
}

function SegmentPageView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<SegmentDetail | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
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
      <div className="mx-auto max-w-[42rem] space-y-4" role="status" aria-label="加载中">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <div className="card px-6 py-8">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className={`mb-4 h-4 ${i === 5 ? 'w-1/2' : 'w-full'}`} />
          ))}
        </div>
      </div>
    );

  const s = data.segment;
  const { outgoing, incoming, relatedTags, prev, next } = data.refs;
  const tier = MEMORY_TIER_LABELS[memoryTier(s.memory)];

  const reload = async () => {
    const d = await api<SegmentDetail>(`/api/segments/${id}`);
    setData(d);
  };

  /** 删除后回到文档；文档已无其他段则回知识库列表 */
  const onDeleted = async () => {
    const docId = data.document?.id;
    if (!docId) {
      router.replace('/notes');
      return;
    }
    const doc = await api<{ segments: unknown[] }>(`/api/notes/${docId}`).catch(() => null);
    router.replace(doc && doc.segments.length > 0 ? `/notes/${docId}` : '/notes');
  };

  // 链接分组：出链/入链/共同标签，空组不渲染
  const groups: LinkGroup[] = [];
  if (outgoing.length > 0) groups.push({ key: 'out', title: `出链（${outgoing.length}）`, hint: '本文提及', items: outgoing });
  if (incoming.length > 0) groups.push({ key: 'in', title: `入链（${incoming.length}）`, hint: '提及本文', items: incoming });
  if (relatedTags.length > 0)
    groups.push({ key: 'tag', title: `共同标签（${relatedTags.length}）`, hint: null, items: relatedTags });

  return (
    <div className="mx-auto max-w-[42rem]">
      {/* 正文优先：精简标题区（面包屑 + 衬线标题 + 单枚灯点） */}
      <div className="fade-up">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/notes/${data.document?.id ?? ''}`}
            className="mt-1 text-tag text-faint transition-colors hover:text-accent hover:underline"
          >
            ← {data.document?.title ?? '文档'}
          </Link>
          <button
            onClick={() => setEditing((v) => !v)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-tag transition-colors duration-150 ${
              editing
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-hover hover:text-primary'
            }`}
          >
            {editing ? '✓ 完成编辑' : '✎ 编辑'}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <h1 className="font-display text-subtitle font-semibold">{s.title}</h1>
          <LampDot memory={s.memory} title={tier} />
        </div>
        {s.headingPath && s.headingPath !== s.title && (
          <p className="mt-1 text-tag text-faint">{s.headingPath}</p>
        )}
        {s.summary && (
          <p className="mt-2 border-l-2 border-accent/40 pl-2.5 font-display text-minor leading-relaxed text-muted">
            {s.summary}
          </p>
        )}
      </div>

      {editing ? (
        <SegmentEditCard
          key={s.id}
          segment={s}
          onSaved={async () => {
            await reload();
            setEditing(false);
          }}
          onDeleted={onDeleted}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <article className="card fade-up mt-4 px-6 py-5" style={{ animationDelay: '80ms' }}>
          <div className="md-body">
            <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
          </div>
        </article>
      )}

      {/* 记忆状态：页脚一行（灯点 + 档位名 + 客观数字），无卡片无进度条 */}
      <p
        className="fade-up mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-minor text-muted"
        style={{ animationDelay: '160ms' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <LampDot memory={s.memory} />
          {tier}
        </span>
        <span className="text-faint">·</span>
        <span>
          阅读 <span className="font-mono tabular-nums">{s.viewCount}</span> 次
        </span>
        <span className="text-faint">·</span>
        <span>
          累计 <span className="font-mono tabular-nums">{formatDuration(s.readingMs)}</span>
        </span>
      </p>

      {/* 页脚极简导航：上一节 ←/→ 下一节（doc 边），无则隐藏对应侧 */}
      {(prev || next) && (
        <nav
          aria-label="相邻章节"
          className="fade-up mt-3 flex items-baseline justify-between gap-4 px-1 text-minor"
          style={{ animationDelay: '200ms' }}
        >
          {prev ? (
            <Link
              href={`/segments/${prev.id}`}
              title={prev.title}
              className="min-w-0 truncate text-muted transition-colors duration-150 hover:text-accent"
            >
              <span className="text-faint">← </span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/segments/${next.id}`}
              title={next.title}
              className="min-w-0 truncate text-right text-muted transition-colors duration-150 hover:text-accent"
            >
              {next.title}
              <span className="text-faint"> →</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {/* 链接区：出链/入链/共同标签分组，默认收起；无链接且无标签时不渲染 */}
      {(groups.length > 0 || s.tags.length > 0) && (
        <details className="group/rel fade-up mt-4" style={{ animationDelay: '240ms' }}>
          <summary className="cursor-pointer list-none px-1 text-tag uppercase text-faint transition-colors hover:text-muted">
            {groups.length > 0 ? `链接 · ${groups.map((g) => g.title).join(' · ')}` : '标签'}
            <span className="ml-1 inline-block transition-transform duration-200 group-open/rel:rotate-90">▸</span>
          </summary>
          <div className="card mt-2 px-4 py-3">
            {s.tags.length > 0 && (
              <div className={groups.length > 0 ? 'flex flex-wrap gap-1.5 border-b border-line pb-3' : 'flex flex-wrap gap-1.5'}>
                {s.tags.map((t) => (
                  <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-tag text-muted">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            {groups.map((g, gi) => (
              <div
                key={g.key}
                className={`${gi > 0 ? 'mt-3 border-t border-line pt-3' : ''} ${s.tags.length > 0 && gi === 0 ? 'pt-3' : ''}`}
              >
                <p className="mb-1.5 text-tag text-muted">
                  {g.title}
                  {g.hint && <span className="ml-1.5 text-faint">{g.hint}</span>}
                </p>
                <ul className="space-y-1.5">
                  {g.items.map((n) => (
                    <li key={n.id}>
                      <Link
                        href={`/segments/${n.id}`}
                        className="group flex items-center justify-between gap-3 text-body transition-colors duration-150 hover:text-accent"
                      >
                        <span className="min-w-0 flex-1 truncate">{n.title}</span>
                        <LampDot memory={n.memory} title={MEMORY_TIER_LABELS[memoryTier(n.memory)]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
