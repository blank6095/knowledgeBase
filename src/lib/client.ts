export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error;
    throw new Error(msg && msg !== 'Unauthorized' ? msg : `请求失败（${res.status}）`);
  }
  return data as T;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDue(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const diff = new Date(d).getTime() - Date.now();
  if (diff <= 0) return '已到期';
  const days = diff / 86400000;
  if (days < 1) return `${Math.max(1, Math.round(diff / 3600000))} 小时后`;
  return `${Math.round(days)} 天后`;
}
