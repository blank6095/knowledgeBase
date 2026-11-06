'use client';

import { useState } from 'react';
import { safeNextPath } from '@/lib/security';
import InlineFeedback from '@/components/InlineFeedback';

export default function LoginPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // UX-24：口令前后空白不 trim 会导致「输入看起来一样却登录失败」，提交前统一去掉
    const code = passcode.trim();
    if (!code) {
      setError('请输入访问口令');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? '登录失败');
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = safeNextPath(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setLoading(false);
    }
  };

  return (
    // login 不走 AppShell，安全区需要自己让出：PWA 全屏下避免内容贴刘海/Home Indicator
    <div className="relative flex min-h-screen items-center justify-center bg-app pb-safe pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-safe">
      {/* 卡顶暖光晕：书桌上的台灯 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[max(2rem,calc(50%_-_16rem))] h-64 w-[28rem] max-w-[90vw] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, var(--ambient-glow), transparent 65%)', filter: 'blur(8px)' }}
      />
      <form
        onSubmit={submit}
        className="card fade-up relative w-full max-w-sm p-8"
        style={{ borderRadius: '1rem' }}
      >
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5 text-accent">
            <path
              d="M12 2.2c.78 5.02 4.58 8.82 9.8 9.8-5.22.98-9.02 4.78-9.8 9.8-.78-5.02-4.58-8.82-9.8-9.8 5.22-.98 9.02-4.78 9.8-9.8Z"
              fill="currentColor"
            />
          </svg>
          <h1 className="font-display text-subtitle font-semibold">知识宇宙</h1>
        </div>
        <p className="mt-1.5 text-minor text-muted">输入访问口令，进入你的知识宇宙。</p>
        <label htmlFor="login-passcode" className="sr-only">
          访问口令
        </label>
        <input
          id="login-passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="访问口令"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
          className="mt-6 w-full rounded-lg border border-line bg-app px-3 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
        />
        {error && (
          <div id="login-error" className="mt-3">
            <InlineFeedback tone="danger">{error}</InlineFeedback>
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !passcode.trim()}
          className="mt-4 w-full rounded-lg bg-accent py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          {loading ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}
