'use client';

import { useState } from 'react';

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
      window.location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-lg">
        <h1 className="text-xl font-semibold">🧠 个人知识库</h1>
        <p className="mt-1 text-sm text-muted">输入访问口令进入</p>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="访问口令"
          autoFocus
          className="mt-6 w-full rounded-lg border border-line bg-app px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={loading || !passcode}
          className="mt-4 w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:opacity-50"
        >
          {loading ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}
