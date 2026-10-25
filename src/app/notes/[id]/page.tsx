'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/client';
import { memoryColor, MEMORY_TIER_LABELS, memoryTier } from '@/lib/memory';
import { Skeleton } from '@/components/Skeleton';

interface DocDetail {
  document: { id: string; title: string; tags: string[]; segmentCount: number; createdAt: string; storageKey: string | null };
  segments: {
    id: string;
    title: string;
    headingPath: string;
    tags: string[];
    viewCount: number;
    content: string;
    memory: number;
  }[];
}

/** 节标题旁的灯点：hover 浮出档位名与阅读次数 */
function SectionLamp({ memory, viewCount }: { memory: number; viewCount: number }) {
  const color = memoryColor(memory);
  const label = MEMORY_TIER_LABELS[memoryTier(memory)];
  return (
    <span className="group/dot relative inline-flex align-middle">
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px 1px ${color}` }} />
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-elevated px-2 py-0.5 text-tag text-primary opacity-0 transition-opacity duration-150 group-hover/dot:opacity-100">
        {label} · 阅读 <span className="font-mono tabular-nums">{viewCount}</span> 次
      </span>
    </span>
  );
}

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocDetail | null>(null);
  const [error, setError] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<DocDetail>(`/api/notes/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  // 顶部阅读进度条：滚动驱动（rAF 节流），宽度直更不含过渡，天然兼容 reduced-motion
  useEffect(() => {
    if (!data) return;
    let raf = 0;
    const update = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      const p = max > 0 ? Math.min(1, el.scrollTop / max) : 0;
      if (barRef.current) barRef.current.style.width = `${(p * 100).toFixed(2)}%`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [data]);

  if (error) return <p className="text-body text-danger">{error}</p>;
  if (!data)
    return (
      <div className="mx-auto max-w-[42rem] space-y-4" role="status" aria-label="加载中">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-72" />
        <div className="card px-6 py-8">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className={`mb-4 h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />
          ))}
        </div>
      </div>
    );

  const { document: doc, segments } = data;

  return (
    <div className="relative mx-auto max-w-[42rem]">
      {/* 阅读进度条：细线横贯顶部 */}
      <div className="fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent">
        <div ref={barRef} className="h-full bg-accent" style={{ width: '0%' }} />
      </div>

      <div className="fade-up">
        <Link href="/notes" className="text-tag text-faint transition-colors hover:text-accent hover:underline">← 知识库</Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-subtitle font-semibold">{doc.title}</h1>
          <span className="font-mono text-tag tabular-nums text-faint">
            {doc.segmentCount} 个知识点
            {doc.storageKey && ' · 原文已备份至 R2'}
          </span>
        </div>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doc.tags.map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-tag text-muted">#{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* 目录锚点 */}
      {segments.length > 1 && (
        <details className="card group/toc fade-up mt-4 px-4 py-2" style={{ animationDelay: '40ms' }}>
          <summary className="cursor-pointer list-none text-tag uppercase text-muted transition-colors hover:text-primary">
            目录
            <span className="ml-1 inline-block transition-transform duration-200 group-open/toc:rotate-90">▸</span>
          </summary>
          <ol className="mt-2 space-y-1 border-t border-line pt-2">
            {segments.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#sec-${i}`}
                  className="flex items-center gap-2 text-minor text-muted transition-colors hover:text-accent"
                >
                  <span className="w-5 shrink-0 text-right font-mono text-tag tabular-nums text-faint">{i + 1}</span>
                  <SectionLamp memory={s.memory} viewCount={s.viewCount} />
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* 整篇连续阅读：节间无卡片切割，标题层级还原（节题=##、折入的 ###/#### 由 markdown 渲染） */}
      <article className="fade-up mt-4" style={{ animationDelay: '80ms' }}>
        {segments.map((s, i) => (
          <section key={s.id} id={`sec-${i}`} className="scroll-mt-16 border-t border-line py-5 first:border-t-0 first:pt-0">
            <h2 className="mb-1 flex items-center gap-2 font-display text-card font-semibold">
              <span className="w-5 shrink-0 text-right font-mono text-tag tabular-nums text-faint">{i + 1}</span>
              {s.title}
              <SectionLamp memory={s.memory} viewCount={s.viewCount} />
            </h2>
            {s.headingPath && s.headingPath !== s.title && (
              <p className="mb-2 pl-7 text-tag text-faint">{s.headingPath}</p>
            )}
            <div className="md-body pl-7">
              <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
            </div>
          </section>
        ))}
      </article>

      {/* 按知识点查看：原列表形态收纳进折叠区 */}
      <details className="card group/list fade-up mt-6 px-4 py-2" style={{ animationDelay: '120ms' }}>
        <summary className="cursor-pointer list-none text-tag uppercase text-muted transition-colors hover:text-primary">
          按知识点查看（{segments.length}）
          <span className="ml-1 inline-block transition-transform duration-200 group-open/list:rotate-90">▸</span>
        </summary>
        <ul className="mt-2 divide-y divide-line border-t border-line">
          {segments.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`/segments/${s.id}`}
                className="group flex items-center gap-3 px-1 py-2.5 transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="w-5 shrink-0 text-center font-mono text-tag tabular-nums text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body transition-colors duration-150 group-hover:text-accent-strong">{s.title}</p>
                  {s.headingPath && s.headingPath !== s.title && (
                    <p className="truncate text-tag text-faint">{s.headingPath}</p>
                  )}
                </div>
                <span className="hidden shrink-0 font-mono text-tag tabular-nums text-muted sm:block" title="阅读次数">
                  {s.viewCount} 次
                </span>
                <SectionLamp memory={s.memory} viewCount={s.viewCount} />
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
