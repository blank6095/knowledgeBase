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

/** 毫秒 → 人类可读时长：不足 1 分钟按秒，之后按分钟，超过 1 小时带小时位 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0 分钟';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}
