'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import type { RecallResult } from '@/lib/learning-plan';
import { Skeleton } from '@/components/Skeleton';

interface QuestionPayload {
  segment: {
    id: string;
    title: string;
    documentId: string;
    documentTitle: string;
  };
  question: string;
  referenceAnswer: string;
  sourceVersion: string;
  generatedBy: 'cache' | 'ai' | 'fallback';
  warning?: string;
}

interface SavedReview {
  id: string;
  reviewedAt: string;
  nextReviewAt: string | null;
}

const RESULT_OPTIONS: { value: RecallResult; label: string; hint: string; className: string }[] = [
  {
    value: 'incorrect',
    label: '没答出',
    hint: '1 天后再次复习',
    className: 'border-danger/35 text-danger hover:bg-danger/10',
  },
  {
    value: 'partial',
    label: '部分掌握',
    hint: '3 天后再次复习',
    className: 'border-warn/35 text-warn hover:bg-warn/10',
  },
  {
    value: 'correct',
    label: '答对了',
    hint: '7 天后再次复习',
    className: 'border-success/35 text-success hover:bg-success/10',
  },
];

export default function StudyPage() {
  const { segmentId } = useParams<{ segmentId: string }>();
  const [attempt, setAttempt] = useState(0);
  return (
    <RecallSession
      key={`${segmentId}:${attempt}`}
      segmentId={segmentId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function RecallSession({ segmentId, onRetry }: { segmentId: string; onRetry: () => void }) {
  const [payload, setPayload] = useState<QuestionPayload | null>(null);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState<SavedReview | null>(null);
  const [saving, setSaving] = useState<RecallResult | null>(null);
  const [error, setError] = useState('');
  const submissionId = useRef<string>('');

  useEffect(() => {
    let alive = true;

    api<QuestionPayload>('/api/learning/question', {
      method: 'POST',
      body: JSON.stringify({ segmentId }),
    })
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message);
      });
    return () => {
      alive = false;
    };
  }, [segmentId]);

  const submit = async (result: RecallResult) => {
    if (!payload || saving || saved) return;
    setSaving(result);
    setError('');
    submissionId.current ||= crypto.randomUUID();
    try {
      const data = await api<{ review: SavedReview }>('/api/learning/reviews', {
        method: 'POST',
        body: JSON.stringify({
          submissionId: submissionId.current,
          segmentId: payload.segment.id,
          question: payload.question,
          referenceAnswer: payload.referenceAnswer,
          answer,
          result,
          sourceVersion: payload.sourceVersion,
        }),
      });
      setSaved(data.review);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '复习记录保存失败');
    } finally {
      setSaving(null);
    }
  };

  if (error && !payload) {
    return (
      <section className="card mx-auto mt-10 max-w-xl px-6 py-8 text-center">
        <p className="font-display text-subtitle text-primary">暂时无法开始这次回忆</p>
        <p className="mt-2 text-minor text-danger">{error}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={onRetry}
            className="rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink hover:bg-accent-strong"
          >
            重新生成
          </button>
          <Link
            href={`/segments/${segmentId}`}
            className="rounded-lg border border-line px-4 py-2 text-body text-muted hover:bg-surface-hover hover:text-primary"
          >
            直接阅读原文
          </Link>
        </div>
      </section>
    );
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" role="status" aria-label="正在准备回忆题">
        <Skeleton className="h-3 w-28" />
        <div className="card space-y-4 px-6 py-7">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    );
  }

  if (saved) {
    return (
      <section className="card mx-auto mt-10 max-w-xl px-6 py-8 text-center fade-up">
        <span className="text-tag uppercase tracking-[0.18em] text-success">复习已记录</span>
        <h1 className="mt-3 font-display text-title font-semibold">这次回忆，已经留下痕迹</h1>
        <p className="mt-2 text-minor text-muted">
          下次建议复习：{formatDate(saved.nextReviewAt)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink hover:bg-accent-strong">
            返回今日学习
          </Link>
          <Link
            href={`/segments/${payload.segment.id}`}
            className="rounded-lg border border-line px-4 py-2 text-body text-muted hover:bg-surface-hover hover:text-primary"
          >
            回看原文
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-2xl fade-up">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-tag text-faint">
        <Link href="/" className="hover:text-accent">← 今日学习</Link>
        <span>·</span>
        <span>{payload.segment.documentTitle}</span>
        <span>·</span>
        <span>主动回忆</span>
      </div>

      <section className="card mt-4 overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <p className="text-tag uppercase tracking-[0.16em] text-accent">先别看原文</p>
          <h1 className="mt-2 font-display text-subtitle font-semibold">{payload.segment.title}</h1>
          <p className="mt-4 text-body leading-relaxed text-primary">{payload.question}</p>
          {payload.warning && <p className="mt-3 text-tag text-warn">{payload.warning}</p>}
        </div>

        <div className="px-6 py-5">
          <label htmlFor="recall-answer" className="text-tag text-muted">
            你的回答
          </label>
          <textarea
            id="recall-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={5}
            disabled={revealed}
            placeholder="先凭记忆作答；完全想不起来也可以留空。"
            className="mt-2 w-full resize-y rounded-xl border border-line bg-app px-3 py-3 text-body leading-relaxed text-primary outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-70"
          />

          {!revealed ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => setRevealed(true)}
                className="rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink transition-colors hover:bg-accent-strong"
              >
                查看参考答案
              </button>
              <span className="text-tag text-faint">先完成回忆，再依据原文校准。</span>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3">
                <p className="text-tag uppercase tracking-[0.12em] text-accent">参考答案</p>
                <p className="mt-2 whitespace-pre-wrap font-display text-body leading-relaxed text-primary">
                  {payload.referenceAnswer}
                </p>
                <Link
                  href={`/segments/${payload.segment.id}`}
                  className="mt-3 inline-block text-tag text-accent hover:text-accent-strong hover:underline"
                >
                  回到原文核对 →
                </Link>
              </div>

              <div>
                <p className="text-tag text-muted">这次实际回忆得怎么样？</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {RESULT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => submit(option.value)}
                      disabled={Boolean(saving) || (option.value !== 'incorrect' && !answer.trim())}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${option.className}`}
                    >
                      <span className="block text-body font-medium">
                        {saving === option.value ? '保存中…' : option.label}
                      </span>
                      <span className="mt-0.5 block text-tag text-faint">{option.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-minor text-danger">{error}</p>}
          {error && revealed && (
            <button
              onClick={onRetry}
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-tag text-muted hover:text-primary"
            >
              内容可能已变化，重新生成题目
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
