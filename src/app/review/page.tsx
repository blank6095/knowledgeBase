'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatDue } from '@/lib/client';
import MasteryBadge from '@/components/MasteryBadge';
import GradeButtons from '@/components/GradeButtons';
import type { Grade } from '@/lib/sm2';

interface QueueItem {
  id: string;
  title: string;
  headingPath: string;
  status: string;
  mastery: number;
  dueAt: string;
  documentTitle: string | null;
}

interface FullSegment {
  segment: {
    id: string;
    title: string;
    content: string;
    headingPath: string;
    ease: number;
    intervalDays: number;
    reps: number;
    lapses: number;
    documentId: string;
  };
  document: { id: string; title: string } | null;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<FullSegment | null>(null);
  const [revealedFor, setRevealedFor] = useState(-1);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');

  // 用户交互（切换范围 / 再来一轮）触发的重载
  const reload = async (all: boolean) => {
    try {
      const res = await api<{ queue: QueueItem[]; dueCount: number }>(`/api/review/next${all ? '?all=1' : ''}`);
      setQueue(res.queue);
      setDueCount(res.dueCount);
      setIndex(0);
      setDetail(null);
      setRevealedFor(-1);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };

  // 初始加载：setState 全部在异步回调中，避免级联渲染
  useEffect(() => {
    let cancelled = false;
    api<{ queue: QueueItem[]; dueCount: number }>('/api/review/next')
      .then((res) => {
        if (!cancelled) {
          setQueue(res.queue);
          setDueCount(res.dueCount);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 预取当前卡片内容
  useEffect(() => {
    const item = queue?.[index];
    if (!item) return;
    let cancelled = false;
    api<FullSegment>(`/api/segments/${item.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [queue, index]);

  const current = queue?.[index];
  const finished = queue !== null && index >= queue.length;
  // 当前卡片是否已翻面：必须与当前题目对应，避免换卡瞬间闪现旧内容
  const revealed = !!current && revealedFor === index && !!detail && detail.segment.id === current.id;

  const onGrade = async (grade: Grade) => {
    if (!current) return;
    try {
      await api(`/api/segments/${current.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ grade }),
      });
      setDone((n) => n + 1);
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    }
  };

  if (error) return <p className="text-red-600">{error}</p>;
  if (!queue) return <p className="text-slate-400">加载中…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">复习</h1>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); reload(e.target.checked); }} />
          包含未到期
        </label>
        <span className="text-sm text-slate-500">
          到期 {dueCount} · 本轮已复习 {done}
        </span>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-lg">🎉 没有到期的知识点</p>
          <p className="mt-2 text-sm text-slate-500">都复习完了，去 <Link href="/import" className="text-blue-600 underline">导入新知识</Link> 或 <Link href="/graph" className="text-blue-600 underline">看看知识网络</Link>。</p>
        </div>
      ) : finished ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-10 text-center">
          <p className="text-lg font-medium text-emerald-800">本轮复习完成 🎉</p>
          <p className="mt-2 text-sm text-emerald-700">共复习 {done} 个知识点</p>
          <div className="mt-4 flex justify-center gap-3 text-sm">
            <button onClick={() => reload(showAll)} className="rounded-lg border border-emerald-300 px-4 py-2 hover:bg-emerald-100">再来一轮</button>
            <Link href="/" className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500">返回概览</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${(index / queue.length) * 100}%` }} />
            </div>
            <span>{index + 1} / {queue.length}</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            {current && (
              <>
                <p className="text-xs text-slate-400">
                  {current.documentTitle}
                  {current.headingPath && current.headingPath !== current.title ? ` · ${current.headingPath}` : ''}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold">{current.title}</h2>
                  <MasteryBadge status={current.status} mastery={current.mastery} />
                  <span className="text-xs text-slate-400">{formatDue(current.dueAt)}</span>
                </div>

                {revealed ? (
                  <>
                    <div className="md-body mt-5 border-t border-slate-100 pt-5">
                      <Markdown remarkPlugins={[remarkGfm]}>{detail!.segment.content}</Markdown>
                    </div>
                    <div className="mt-6">
                      <p className="mb-2 text-center text-sm text-slate-500">回忆得怎么样？</p>
                      <GradeButtons
                        state={{
                          ease: detail!.segment.ease,
                          intervalDays: detail!.segment.intervalDays,
                          reps: detail!.segment.reps,
                          lapses: detail!.segment.lapses,
                        }}
                        onGrade={onGrade}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mt-8 flex justify-center">
                    <button
                      onClick={() => setRevealedFor(index)}
                      disabled={!detail}
                      className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm hover:bg-slate-100 disabled:opacity-50"
                    >
                      先回忆，再显示内容
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
