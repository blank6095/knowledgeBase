'use client';

import { useState } from 'react';
import { safeNextPath } from '@/lib/security';

export default function LoginPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
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
    <div className="relative flex min-h-screen items-center justify-center bg-app px-4">
      {/* 卡顶暖光晕：书桌上的台灯 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[max(2rem,calc(50%_-_16rem))] h-64 w-[28rem] max-w-[90vw] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgba(232,176,75,0.10), transparent 65%)', filter: 'blur(8px)' }}
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
          <h1 className="font-display text-subtitle font-semibold">暗夜书房</h1>
        </div>
        <p className="mt-1.5 text-minor text-muted">输入访问口令，进入你的书房。</p>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="访问口令"
          autoFocus
          className="mt-6 w-full rounded-lg border border-line bg-app px-3 py-2 text-body text-primary outline-none transition-colors placeholder:text-faint focus:border-accent"
        />
        {error && <p className="mt-3 text-minor text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading || !passcode}
          className="mt-4 w-full rounded-lg bg-accent py-2 text-body font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
        >
          {loading ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}
