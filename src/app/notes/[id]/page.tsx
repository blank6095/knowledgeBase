'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatDate } from '@/lib/client';
import { MEMORY_TIER_LABELS, memoryTier } from '@/lib/memory';
import { LampDot } from '@/components/MemoryBadge';
import { Skeleton } from '@/components/Skeleton';
import SectionEditor from '@/components/SectionEditor';
import AiOverlay from '@/components/AiOverlay';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_ORDER,
  locate,
  MIN_QUOTE_LEN,
  type AnnotationColor,
  type AnnotationKind,
} from '@/lib/annotations';
import { injectMarks, type MarkSpec } from '@/lib/highlight';

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

interface AnnotationRow {
  id: string;
  segmentId: string;
  kind: AnnotationKind;
  quote: string | null;
  occurrence: number;
  prefix: string | null;
  suffix: string | null;
  note: string | null;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
  segmentTitle: string;
  segmentOrder: number;
}

/** 选区产生的标注锚点（在段渲染文本上的四元组） */
interface SelAnchor {
  x: number;
  y: number;
  segId: string;
  quote: string;
  occurrence: number;
  prefix: string;
  suffix: string;
}

/** memo 化 Markdown：内容不变时避免 React 重渲染破坏已注入的划线 DOM */
const MdBlock = React.memo(function MdBlock({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>;
});

/** 灯点摘要状态：hover 惰性拉取，页面级共享 */
interface LampSummary {
  text?: string;
  loading?: boolean;
  failed?: boolean;
}

/** 节标题旁的灯点：hover 浮出档位名、阅读次数与 30 字摘要（首次 hover 触发生成） */
function SectionLamp({
  memory,
  viewCount,
  segId,
  summary,
  onEnsureSummary,
}: {
  memory: number;
  viewCount: number;
  segId?: string;
  summary?: LampSummary;
  onEnsureSummary?: (segId: string) => void;
}) {
  return (
    <span
      className="group/dot relative inline-flex align-middle"
      onMouseEnter={segId && onEnsureSummary ? () => onEnsureSummary(segId) : undefined}
    >
      <LampDot memory={memory} />
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-md border border-line bg-elevated px-2 py-1 text-tag text-primary shadow-lg group-hover/dot:block">
        <span className="block whitespace-nowrap">
          {MEMORY_TIER_LABELS[memoryTier(memory)]} · 阅读 <span className="font-mono tabular-nums">{viewCount}</span> 次
        </span>
        {summary?.loading && <span className="mt-0.5 block whitespace-nowrap text-faint">摘要生成中…</span>}
        {summary?.text && <span className="mt-0.5 block max-w-60 whitespace-normal leading-relaxed text-faint">{summary.text}</span>}
      </span>
    </span>
  );
}

/** 目录条目列表：序号 + 灯点 + 标题（≥1280px 导轨与 <1280px 浮层共用） */
function TocList({
  sections,
  active,
  summaries,
  onEnsureSummary,
  onNavigate,
}: {
  sections: DocDetail['segments'];
  active: number;
  summaries: Record<string, LampSummary>;
  onEnsureSummary: (segId: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <ol className="space-y-0.5">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#sec-${i}`}
            onClick={onNavigate}
            title={s.title}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-minor transition-colors duration-150 ${
              i === active ? 'bg-accent/10 text-accent-strong' : 'text-muted hover:bg-surface-hover hover:text-primary'
            }`}
          >
            <span className="w-4 shrink-0 text-right font-mono text-tag tabular-nums text-faint">{i + 1}</span>
            <span onMouseEnter={() => onEnsureSummary(s.id)}>
              <SectionLamp memory={s.memory} viewCount={s.viewCount} segId={s.id} summary={summaries[s.id]} onEnsureSummary={onEnsureSummary} />
            </span>
            <span className="truncate">{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

const IcToc = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
    <path d="M4 6h16M4 12h10M4 18h7" />
  </svg>
);

const excerpt = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);
const clampX = (x: number) => Math.min(Math.max(x, 120), (typeof window === 'undefined' ? 1200 : window.innerWidth) - 120);
const MIN_READING_MS = 5_000;

interface SectionReadingSession {
  opened: boolean;
  since: number | null;
  dwellMs: number;
}

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DocDetail | null>(null);
  const [error, setError] = useState('');
  const [activeSec, setActiveSec] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const readingSessions = useRef(new Map<string, SectionReadingSession>());
  const activeReadingId = useRef<string | null>(null);
  const readingVisible = useRef(true);
  const readingDocId = useRef<string | null>(null);

  // 编辑模式
  const [editing, setEditing] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docTagsInput, setDocTagsInput] = useState('');
  const [docMsg, setDocMsg] = useState('');
  const [deleting, setDeleting] = useState(false);
  // AI 语义拆解/聚合
  const [llmReady, setLlmReady] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [aggBusy, setAggBusy] = useState(false);
  const [aggMsg, setAggMsg] = useState('');
  const [aggPreview, setAggPreview] = useState<{ title: string; content: string } | null>(null);

  // 标注
  const [annotations, setAnnotations] = useState<AnnotationRow[] | null>(null);
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  const [selPop, setSelPop] = useState<SelAnchor | null>(null);
  const [popMode, setPopMode] = useState<'color' | 'note'>('color');
  const [noteText, setNoteText] = useState('');
  const [noteColor, setNoteColor] = useState<AnnotationColor>('amber');
  const [annoMsg, setAnnoMsg] = useState('');
  const [viewCard, setViewCard] = useState<{ x: number; y: number; ann: AnnotationRow } | null>(null);
  const [secNote, setSecNote] = useState<{ x: number; y: number; segId: string } | null>(null);
  const [secNoteText, setSecNoteText] = useState('');
  const popModeRef = useRef(popMode);
  useEffect(() => {
    popModeRef.current = popMode;
  }, [popMode]);

  const reload = async () => {
    const d = await api<DocDetail>(`/api/notes/${id}`);
    setData(d);
    setDocTitle(d.document.title);
    setDocTagsInput(d.document.tags.join(', '));
    return d;
  };
  const reloadAnnotations = async () => {
    const d = await api<{ annotations: AnnotationRow[] }>(`/api/notes/${id}/annotations`);
    setAnnotations(d.annotations);
  };

  // 灯点摘要缓存：首次 hover 触发生成（服务端 in-flight 去重），成功后页面级记住
  const [summaries, setSummaries] = useState<Record<string, LampSummary>>({});
  const ensureSummary = (segId: string) => {
    if (summaries[segId]?.text || summaries[segId]?.loading) return;
    setSummaries((prev) => ({ ...prev, [segId]: { ...prev[segId], loading: true } }));
    api<{ summary: string }>(`/api/segments/${segId}/summary`)
      .then((d) => setSummaries((prev) => ({ ...prev, [segId]: { text: d.summary } })))
      .catch(() => setSummaries((prev) => ({ ...prev, [segId]: { failed: true } })));
  };

  // 节级笔记（无引文）按段分组：标题旁查看入口用
  const secNotes = useMemo(() => {
    const m = new Map<string, AnnotationRow[]>();
    for (const a of annotations ?? []) {
      if (a.kind === 'note' && !a.quote) m.set(a.segmentId, [...(m.get(a.segmentId) ?? []), a]);
    }
    return m;
  }, [annotations]);

  useEffect(() => {
    api<DocDetail>(`/api/notes/${id}`)
      .then((d) => {
        setData(d);
        setDocTitle(d.document.title);
        setDocTagsInput(d.document.tags.join(', '));
      })
      .catch((e) => setError(e.message));
    api<{ annotations: AnnotationRow[] }>(`/api/notes/${id}/annotations`)
      .then((d) => setAnnotations(d.annotations))
      .catch(() => setAnnotations([]));
  }, [id]);

  // 整篇连续阅读：当前可见节累计停留；切节、隐藏或卸载时提交有效阅读。
  useEffect(() => {
    if (!data || editing) return;
    const sessions = readingSessions.current;
    if (readingDocId.current !== data.document.id) {
      sessions.clear();
      readingDocId.current = data.document.id;
      activeReadingId.current = null;
    }

    const ensureSession = (segId: string) => {
      let session = sessions.get(segId);
      if (!session) {
        session = { opened: false, since: null, dwellMs: 0 };
        sessions.set(segId, session);
      }
      return session;
    };

    const sendDuration = (segId: string, durationMs: number, useBeacon: boolean) => {
      const body = JSON.stringify({ durationMs });
      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(`/api/segments/${segId}/view`, new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch(`/api/segments/${segId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    };

    const pauseActive = (now: number) => {
      const segId = activeReadingId.current;
      if (!segId) return;
      const session = sessions.get(segId);
      if (!session?.since || !readingVisible.current) return;
      session.dwellMs += Math.max(0, now - session.since);
      session.since = null;
    };

    const flushEligible = (useBeacon: boolean, now = Date.now()) => {
      pauseActive(now);
      for (const [segId, session] of sessions) {
        if (session.dwellMs < MIN_READING_MS) continue;
        const durationMs = Math.round(session.dwellMs);
        session.dwellMs = 0;
        sendDuration(segId, durationMs, useBeacon);
      }
    };

    const activeId = data.segments[activeSec]?.id;
    if (activeId) {
      activeReadingId.current = activeId;
      const session = ensureSession(activeId);
      if (!session.opened) {
        session.opened = true;
        fetch(`/api/segments/${activeId}/view`, { method: 'POST', keepalive: true }).catch(() => {
          session.opened = false;
        });
      }
      if (readingVisible.current) session.since = Date.now();
    }

    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        readingVisible.current = false;
        flushEligible(true, now);
        return;
      }
      readingVisible.current = true;
      const session = activeReadingId.current ? sessions.get(activeReadingId.current) : null;
      if (session) session.since = now;
    };
    const onPageHide = () => {
      readingVisible.current = false;
      flushEligible(true);
    };
    const onPageShow = () => {
      readingVisible.current = true;
      const session = activeReadingId.current ? sessions.get(activeReadingId.current) : null;
      if (session && document.visibilityState === 'visible') session.since = Date.now();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      flushEligible(false);
      activeReadingId.current = null;
    };
  }, [data, editing, activeSec]);

  // 顶部阅读进度条：滚动驱动（rAF 节流）
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

  // 目录联动：IntersectionObserver 检测带内命中的最小索引为当前节
  useEffect(() => {
    if (!data || editing) return;
    const els = data.segments
      .map((_, i) => document.getElementById(`sec-${i}`))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const indexOf = new Map(els.map((el, i) => [el, i] as const));
    const visible = new Map<Element, boolean>();
    const compute = () => {
      let idx = -1;
      for (const [el, i] of indexOf) {
        if (visible.get(el)) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) setActiveSec((prev) => (prev === idx ? prev : idx));
    };
    const ob = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target, e.isIntersecting);
        compute();
      },
      { rootMargin: '-72px 0px -75% 0px' },
    );
    els.forEach((el) => ob.observe(el));
    const onScroll = () => {
      const doc = document.documentElement;
      if (window.innerHeight + Math.ceil(window.scrollY) >= doc.scrollHeight - 4) {
        setActiveSec((prev) => (prev === els.length - 1 ? prev : els.length - 1));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ob.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [data, editing]);

  // 浮层目录 / 各弹层：Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTocOpen(false);
      setViewCard(null);
      if (popModeRef.current === 'color') setSelPop(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 阅读态划线注入：锚点定位 → DOM 包裹；失败集合供列表灰显
  useEffect(() => {
    if (editing || !data) return;
    const bySeg = new Map<string, AnnotationRow[]>();
    for (const a of annotations ?? []) {
      if (!a.quote) continue;
      bySeg.set(a.segmentId, [...(bySeg.get(a.segmentId) ?? []), a]);
    }
    const failed = new Set<string>();
    for (const [segId, rows] of bySeg) {
      const el = document.querySelector<HTMLElement>(`section[data-seg-id="${segId}"]`);
      if (!el) continue;
      const body = el.querySelector<HTMLElement>('.md-body');
      if (!body) continue;
      const text = body.textContent ?? '';
      const specs: MarkSpec[] = [];
      for (const a of rows) {
        const quote = a.quote;
        if (!quote) continue;
        const r = locate({ quote, occurrence: a.occurrence, prefix: a.prefix, suffix: a.suffix }, text);
        if (r) specs.push({ id: a.id, start: r.start, end: r.end, color: a.color, hasNote: a.kind === 'note' && !!a.note });
        else failed.add(a.id);
      }
      injectMarks(body, specs);
    }
    // 注入完成后再回写失效集合：DOM 副作用与状态解耦，微任务时机避开 effect 内同步 setState
    queueMicrotask(() => setInvalidIds(failed));
  }, [data, annotations, editing]);

  // 阅读态选区 → 划线/笔记 popover
  useEffect(() => {
    if (editing) return;
    const onMouseUp = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-anno-pop]')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const quote = sel.toString().trim();
      if (quote.length < MIN_QUOTE_LEN) return;
      const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const body = anchorEl?.closest('.md-body') as HTMLElement | null;
      const sec = body?.closest('section[data-seg-id]') as HTMLElement | null;
      if (!sec || !sec.dataset.segId) return;

      const range = sel.getRangeAt(0);
      const endEl = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
      if (!body || !endEl || !body.contains(endEl)) return;
      const secText = body.textContent ?? '';
      const pre = range.cloneRange();
      pre.selectNodeContents(body);
      pre.setEnd(range.startContainer, range.startOffset);
      const startOff = pre.toString().length;

      let occ = 1;
      let idx = secText.indexOf(quote);
      while (idx !== -1 && idx < startOff) {
        occ += 1;
        idx = secText.indexOf(quote, idx + quote.length);
      }

      const rect = range.getBoundingClientRect();
      setAnnoMsg('');
      setNoteText('');
      setPopMode('color');
      setSelPop({
        x: clampX(rect.left + rect.width / 2),
        y: Math.max(rect.top - 10, 56),
        segId: sec.dataset.segId,
        quote,
        occurrence: occ,
        prefix: secText.slice(Math.max(0, startOff - 20), startOff),
        suffix: secText.slice(startOff + quote.length, startOff + quote.length + 20),
      });
    };
    const onSelChange = () => {
      const sel = window.getSelection();
      if ((!sel || sel.isCollapsed) && popModeRef.current === 'color') setSelPop(null);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [editing]);

  // 点击已注入的 mark / 节级笔记图标外的区域 → 收起查看卡
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-anno-pop]') || t.closest?.('mark.hl-mark') || t.closest?.('[data-sec-note]')) return;
      setViewCard(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const createAnnotation = async (kind: AnnotationKind, color: AnnotationColor, note?: string) => {
    if (!selPop) return;
    if (kind === 'note' && !(note ?? '').trim()) {
      setAnnoMsg('笔记内容不能为空');
      return;
    }
    try {
      await api(`/api/segments/${selPop.segId}/annotations`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          quote: selPop.quote,
          occurrence: selPop.occurrence,
          prefix: selPop.prefix,
          suffix: selPop.suffix,
          note: note ?? null,
          color,
        }),
      });
      setSelPop(null);
      setViewCard(null);
      window.getSelection()?.removeAllRanges();
      await reloadAnnotations();
    } catch (e) {
      setAnnoMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const saveSecNote = async () => {
    if (!secNote || !secNoteText.trim()) return;
    try {
      await api(`/api/segments/${secNote.segId}/annotations`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'note', note: secNoteText, color: 'amber' }),
      });
      setSecNote(null);
      setSecNoteText('');
      await reloadAnnotations();
    } catch {
      /* 单用户场景，失败静默重试由用户重触发 */
    }
  };

  const deleteAnnotation = async (annId: string) => {
    await api(`/api/annotations/${annId}`, { method: 'DELETE' }).catch(() => null);
    setViewCard(null);
    await reloadAnnotations();
  };

  const gotoAnnotation = (a: AnnotationRow) => {
    document.getElementById(`sec-${a.segmentOrder}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const el = document.querySelector(`mark.hl-mark[data-aid="${a.id}"]`);
      if (el) {
        el.classList.add('hl-flash');
        setTimeout(() => el.classList.remove('hl-flash'), 1400);
      }
    }, 480);
  };

  const saveDocMeta = async () => {
    setDocMsg('');
    try {
      await api(`/api/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: docTitle,
          tags: docTagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        }),
      });
      await reload();
      setDocMsg('已保存');
    } catch (e) {
      setDocMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const deleteDocument = async () => {
    if (!data || deleting) return;
    if (!window.confirm(`永久删除「${data.document.title}」及其全部知识点、划线和阅读记录？此操作无法撤销。`)) return;
    setDeleting(true);
    setDocMsg('');
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      router.replace('/notes');
    } catch (e) {
      setDocMsg(e instanceof Error ? e.message : '删除失败');
      setDeleting(false);
    }
  };

  const insertAfter = async (index: number) => {
    await api(`/api/notes/${id}/segments`, { method: 'POST', body: JSON.stringify({ afterIndex: index + 1 }) });
    await reload();
  };

  const toggleSelect = (segId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId);
      else next.add(segId);
      return next;
    });
  };

  const aggregatePreviewCall = async () => {
    setAggBusy(true);
    setAggMsg('');
    try {
      const d = await api<{ merged: { title: string; content: string } }>('/api/ai/aggregate-preview', {
        method: 'POST',
        body: JSON.stringify({ segmentIds: [...selectedIds] }),
      });
      setAggPreview(d.merged);
    } catch (e) {
      setAggMsg(e instanceof Error ? e.message : '聚合失败');
    } finally {
      setAggBusy(false);
    }
  };

  const aggregateApply = async () => {
    if (!aggPreview) return;
    setAggBusy(true);
    setAggMsg('');
    try {
      await api('/api/ai/aggregate-apply', {
        method: 'POST',
        body: JSON.stringify({ segmentIds: [...selectedIds], merged: aggPreview }),
      });
      setAggPreview(null);
      setSelectedIds(new Set());
      await reload();
      await reloadAnnotations();
    } catch (e) {
      setAggMsg(e instanceof Error ? e.message : '应用聚合失败');
    } finally {
      setAggBusy(false);
    }
  };

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
  const hasToc = segments.length > 1 && !editing;

  const onArticleClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('mark.hl-mark');
    if (!mark) return;
    const aid = mark.getAttribute('data-aid');
    const ann = annotations?.find((a) => a.id === aid);
    if (!ann) return;
    const r = (mark as HTMLElement).getBoundingClientRect();
    setViewCard({ x: clampX(r.left + r.width / 2), y: Math.max(r.top - 8, 56), ann });
  };

  return (
    <div className="relative mx-auto max-w-[42rem]">
      {/* 阅读进度条 */}
      <div className="fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent">
        <div ref={barRef} className="h-full bg-accent" style={{ width: '0%' }} />
      </div>

      {/* ≥1280px：固定目录导轨 */}
      {hasToc && (
        <nav
          aria-label="阅读目录"
          className="fixed top-24 z-20 hidden max-h-[calc(100vh-8rem)] w-40 overflow-y-auto pb-6 xl:block"
          style={{ left: 'calc(50% + var(--sidebar-w, 0rem) / 2 + 21rem + 1rem)' }}
        >
          <p className="mb-1.5 px-2 text-tag uppercase text-faint">目录</p>
          <TocList sections={segments} active={activeSec} summaries={summaries} onEnsureSummary={ensureSummary} />
        </nav>
      )}

      {/* <1280px：右下角悬浮目录钮 */}
      {hasToc && (
        <button
          onClick={() => setTocOpen(true)}
          aria-label="打开目录"
          className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-elevated text-muted shadow-lg transition-colors duration-150 hover:text-primary xl:hidden"
        >
          <IcToc className="h-5 w-5" />
        </button>
      )}

      {/* <1280px：浮层目录 */}
      {tocOpen && (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="目录" onClick={() => setTocOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <nav
            className="absolute bottom-20 right-4 max-h-[65vh] w-72 overflow-y-auto rounded-xl border border-line bg-elevated p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1.5 px-1 text-tag uppercase text-faint">目录</p>
            <TocList sections={segments} active={activeSec} summaries={summaries} onEnsureSummary={ensureSummary} onNavigate={() => setTocOpen(false)} />
          </nav>
        </div>
      )}

      <div className="fade-up">
        <div className="flex items-start justify-between gap-3">
          <Link href="/notes" className="mt-1 text-tag text-faint transition-colors hover:text-accent hover:underline">← 知识库</Link>
          <button
            onClick={() => {
              const next = !editing;
              setEditing(next);
              setSelectedIds(new Set());
              setAggPreview(null);
              if (next) {
                // 进入编辑模式时探测 LLM 可用性（失败按未配置处理，按钮禁用）
                api<{ configured: boolean }>('/api/ai/config')
                  .then((c) => setLlmReady(c.configured))
                  .catch(() => setLlmReady(false));
              }
            }}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-tag transition-colors duration-150 ${
              editing
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-hover hover:text-primary'
            }`}
          >
            {editing ? '✓ 完成编辑' : '✎ 编辑'}
          </button>
        </div>
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

      {/* 编辑模式：文档元信息 */}
      {editing && (
        <div className="card fade-up mt-4 space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-56 flex-1 items-center gap-2 text-tag text-muted">
              标题
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 text-body text-primary outline-none transition-colors focus:border-accent"
              />
            </label>
            <label className="flex min-w-56 flex-1 items-center gap-2 text-tag text-muted">
              标签
              <input
                value={docTagsInput}
                onChange={(e) => setDocTagsInput(e.target.value)}
                placeholder="逗号分隔"
                className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-1.5 text-body text-primary outline-none transition-colors focus:border-accent"
              />
            </label>
            <button
              onClick={saveDocMeta}
              className="rounded-lg border border-line px-3 py-1.5 text-tag text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
            >
              保存文档信息
            </button>
            <button
              onClick={deleteDocument}
              disabled={deleting}
              className="ml-auto rounded-lg border border-danger/30 px-3 py-1.5 text-tag text-danger transition-colors duration-150 hover:bg-danger/10 disabled:opacity-50"
            >
              {deleting ? '删除中…' : '删除文档'}
            </button>
            {docMsg && <span className="text-tag text-faint">{docMsg}</span>}
          </div>
          <p className="text-tag text-faint">段落编辑保存时保留全部记忆数据；增删/移动会自动维护同文档相邻关联。</p>
        </div>
      )}

      {/* 编辑模式：段落编辑卡 */}
      {editing ? (
        <div className="mt-4 space-y-3">
          {selectedIds.size >= 2 && (
            <div className="card sticky top-14 md:top-2 z-10 flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="text-minor text-muted">
                已选 <span className="font-mono tabular-nums text-primary">{selectedIds.size}</span> 段
              </span>
              <button
                onClick={aggregatePreviewCall}
                disabled={aggBusy}
                title="把所选段落融合为一段（预览后应用）"
                className="rounded-lg bg-accent px-3 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                {aggBusy ? '聚合中…' : `✨ 聚合所选（${selectedIds.size}）`}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg border border-line px-3 py-1.5 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
              >
                清除选择
              </button>
              {aggMsg && <span className="text-tag text-danger">{aggMsg}</span>}
            </div>
          )}
          {segments.length === 0 && (
            <button
              onClick={() => insertAfter(-1)}
              className="card fade-up w-full px-4 py-6 text-minor text-muted transition-colors duration-150 hover:text-accent"
            >
              ＋ 插入第一段
            </button>
          )}
          {segments.map((s, i) => (
            <SectionEditor
              key={s.id}
              index={i}
              segment={s}
              selected={selectedIds.has(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
              llmReady={llmReady}
              onSaved={reload}
              onStructureChanged={reload}
              onInsertAfter={() => insertAfter(i)}
            />
          ))}
        </div>
      ) : (
        <>
          {/* 整篇连续阅读 */}
          <article className="fade-up mt-4" style={{ animationDelay: '80ms' }} onClick={onArticleClick}>
            {segments.map((s, i) => {
              const notes = secNotes.get(s.id) ?? [];
              return (
                <section
                  key={s.id}
                  id={`sec-${i}`}
                  data-seg-id={s.id}
                  className="group/sec scroll-mt-16 border-t border-line py-5 first:border-t-0 first:pt-0"
                >
                  <h2 className="mb-1 flex items-center gap-2 font-display text-card font-semibold">
                    <span className="w-5 shrink-0 text-right font-mono text-tag tabular-nums text-faint">{i + 1}</span>
                    {s.title}
                    <SectionLamp memory={s.memory} viewCount={s.viewCount} segId={s.id} summary={summaries[s.id]} onEnsureSummary={ensureSummary} />
                    {notes.length > 0 && (
                      <button
                        data-sec-note
                        aria-label={`本节笔记 ${notes.length} 条`}
                        title="本节笔记"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setViewCard({ x: clampX(r.left), y: Math.max(r.top - 8, 56), ann: notes[notes.length - 1] });
                        }}
                        className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-tag text-muted transition-colors duration-150 hover:text-accent"
                      >
                        ✎{notes.length > 1 && <span className="font-mono tabular-nums">{notes.length}</span>}
                      </button>
                    )}
                    <button
                      aria-label="添加本节笔记"
                      title="添加本节笔记"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSecNoteText('');
                        setSecNote({ x: clampX(r.left + 40), y: Math.max(r.top - 8, 56), segId: s.id });
                      }}
                      className="inline-flex items-center rounded px-1 text-tag text-faint opacity-0 transition-opacity duration-150 hover:text-accent focus-visible:opacity-100 group-hover/sec:opacity-100"
                    >
                      ✎＋
                    </button>
                  </h2>
                  {s.headingPath && s.headingPath !== s.title && (
                    <p className="mb-2 pl-7 text-tag text-faint">{s.headingPath}</p>
                  )}
                  <div className="md-body pl-7">
                    <MdBlock content={s.content} />
                  </div>
                </section>
              );
            })}
            {segments.length === 0 && (
              <div className="card px-6 py-10 text-center">
                <p className="font-display text-body text-primary">这篇文档还没有内容。</p>
                <p className="mt-1.5 text-minor text-muted">点右上角「✎ 编辑」插入第一段。</p>
              </div>
            )}
          </article>

          {/* 本文标注列表 */}
          {annotations && annotations.length > 0 && (
            <details className="card group/anno fade-up mt-6 px-4 py-2" style={{ animationDelay: '100ms' }}>
              <summary className="cursor-pointer list-none text-tag uppercase text-muted transition-colors hover:text-primary">
                本文标注（{annotations.length}）
                <span className="ml-1 inline-block transition-transform duration-200 group-open/anno:rotate-90">▸</span>
              </summary>
              <ul className="mt-2 space-y-1 border-t border-line pt-2">
                {annotations.map((a) => {
                  const invalid = invalidIds.has(a.id);
                  return (
                    <li key={a.id} className={invalid ? 'opacity-50' : ''}>
                      <div className="flex items-center gap-2 py-1">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ANNOTATION_COLORS[a.color]?.dot ?? '#e8b04b' }} />
                        <button
                          onClick={() => !invalid && a.quote && gotoAnnotation(a)}
                          disabled={invalid || !a.quote}
                          className="min-w-0 flex-1 truncate text-left text-minor text-muted transition-colors duration-150 hover:text-primary disabled:cursor-default"
                          title={a.quote ?? a.note ?? ''}
                        >
                          {a.quote ? `“${excerpt(a.quote)}”` : `节级笔记 · ${a.segmentTitle}`}
                        </button>
                        {a.note && <span className="hidden max-w-40 truncate text-tag text-faint sm:block">✎ {excerpt(a.note, 24)}</span>}
                        {invalid && <span className="shrink-0 text-tag text-warn">已失效</span>}
                        <button
                          onClick={() => deleteAnnotation(a.id)}
                          aria-label="删除标注"
                          className="shrink-0 rounded px-1 text-tag text-faint transition-colors duration-150 hover:text-danger"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {invalidIds.size > 0 && (
                <p className="mt-2 border-t border-line pt-2 text-tag text-faint">失效标注：原文已被编辑，锚点无法重定位，可删除后重新划线。</p>
              )}
            </details>
          )}

          {/* 按知识点查看 */}
          <details className="card group/list fade-up mt-3 px-4 py-2" style={{ animationDelay: '120ms' }}>
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
        </>
      )}

      {/* 选区划线/笔记 popover */}
      {selPop && (
        <div
          data-anno-pop
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: selPop.x, top: selPop.y }}
        >
          {popMode === 'color' ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1.5 shadow-xl">
              {ANNOTATION_COLOR_ORDER.map((c) => (
                <button
                  key={c}
                  title={`划线 · ${ANNOTATION_COLORS[c].label}`}
                  aria-label={`划线 · ${ANNOTATION_COLORS[c].label}`}
                  onClick={() => createAnnotation('highlight', c)}
                  className="h-5 w-5 rounded-full border border-line-strong transition-transform duration-150 hover:scale-110"
                  style={{ background: ANNOTATION_COLORS[c].dot }}
                />
              ))}
              <span className="mx-0.5 h-4 w-px bg-line" />
              <button
                onClick={() => setPopMode('note')}
                className="rounded px-1.5 py-0.5 text-tag text-muted transition-colors duration-150 hover:text-primary"
              >
                ✎ 笔记
              </button>
            </div>
          ) : (
            <div className="w-72 rounded-lg border border-line bg-elevated p-2.5 shadow-xl">
              <p className="mb-1.5 truncate text-tag text-faint" title={selPop.quote}>“{excerpt(selPop.quote, 60)}”</p>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
                placeholder="写下想法…"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                {ANNOTATION_COLOR_ORDER.map((c) => (
                  <button
                    key={c}
                    aria-label={ANNOTATION_COLORS[c].label}
                    onClick={() => setNoteColor(c)}
                    className={`h-4 w-4 rounded-full border ${noteColor === c ? 'border-accent' : 'border-line-strong'}`}
                    style={{ background: ANNOTATION_COLORS[c].dot }}
                  />
                ))}
                <div className="flex-1" />
                <button onClick={() => setSelPop(null)} className="rounded px-2 py-1 text-tag text-muted transition-colors duration-150 hover:text-primary">取消</button>
                <button
                  onClick={() => createAnnotation('note', noteColor, noteText)}
                  className="rounded bg-accent px-2.5 py-1 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong"
                >
                  保存
                </button>
              </div>
              {annoMsg && <p className="mt-1 text-tag text-danger">{annoMsg}</p>}
            </div>
          )}
        </div>
      )}

      {/* 标注查看卡 */}
      {viewCard && (
        <div
          data-anno-pop
          className="fixed z-50 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-elevated p-3 shadow-xl"
          style={{ left: viewCard.x, top: viewCard.y }}
        >
          {viewCard.ann.quote && (
            <p className="mb-1.5 border-l-2 border-accent/50 pl-2 text-minor leading-relaxed text-faint">{excerpt(viewCard.ann.quote, 90)}</p>
          )}
          {viewCard.ann.note && <p className="whitespace-pre-wrap text-body leading-relaxed text-primary">{viewCard.ann.note}</p>}
          <p className="mt-2 flex items-center justify-between gap-2 text-tag text-faint">
            <span className="truncate">
              {formatDate(viewCard.ann.createdAt)} · {viewCard.ann.segmentTitle}
            </span>
            <button onClick={() => deleteAnnotation(viewCard.ann.id)} className="shrink-0 transition-colors duration-150 hover:text-danger">
              删除
            </button>
          </p>
        </div>
      )}

      {/* 节级笔记编辑弹层 */}
      {secNote && (
        <div
          data-anno-pop
          className="fixed z-50 w-72 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-elevated p-2.5 shadow-xl"
          style={{ left: secNote.x, top: secNote.y }}
        >
          <textarea
            value={secNoteText}
            onChange={(e) => setSecNoteText(e.target.value)}
            rows={3}
            autoFocus
            className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-minor text-primary outline-none transition-colors focus:border-accent"
            placeholder="本节笔记…"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button onClick={() => setSecNote(null)} className="rounded px-2 py-1 text-tag text-muted transition-colors duration-150 hover:text-primary">取消</button>
            <button
              onClick={saveSecNote}
              disabled={!secNoteText.trim()}
              className="rounded bg-accent px-2.5 py-1 text-tag font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* AI 聚合预览浮层：只读融合稿 → 确认应用 */}
      {editing && aggPreview && (
        <AiOverlay
          title="AI 聚合预览"
          subtitle={`所选 ${selectedIds.size} 段将融合为一段：位置取原最前段，记忆合并（stability 取最大、阅读数据求和），划线与笔记自动迁移`}
          onClose={() => setAggPreview(null)}
          footer={
            <>
              <button
                onClick={() => setAggPreview(null)}
                className="rounded-lg border border-line px-4 py-1.5 text-minor text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-primary"
              >
                取消
              </button>
              <button
                onClick={aggregateApply}
                disabled={aggBusy}
                className="rounded-lg bg-accent px-4 py-1.5 text-minor font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                {aggBusy ? '应用中…' : '应用聚合'}
              </button>
            </>
          }
        >
          <div className="rounded-lg border border-line bg-app/50 px-3 py-2.5">
            <p className="font-display text-minor font-semibold text-primary">{aggPreview.title}</p>
            <div className="md-body mt-1 text-minor">
              <Markdown remarkPlugins={[remarkGfm]}>{aggPreview.content}</Markdown>
            </div>
          </div>
        </AiOverlay>
      )}
    </div>
  );
}
