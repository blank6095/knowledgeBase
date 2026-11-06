/**
 * 请求错误：保留 HTTP 状态码，让调用方能区分「会话过期（401）」与其他失败。
 * 旧实现统一抛 `new Error(msg)`，401 在组件里只能显示成「请求失败（401）」。
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 会话过期判定：调用方可用它跳过「请求失败」红字，因为跳转已由 api() 完成 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * 会话失效的统一出口：带上 next 回跳当前页面。
 *
 * 登录页自身与认证接口除外，否则「口令错误（401）」会把登录页重定向到自己。
 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname.startsWith('/login/')) return;
  const next = `${pathname}${search}`;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

const AUTH_ENDPOINTS = ['/api/auth/'];

/**
 * 把传输层/协议层失败翻译成用户可行动的中文文案（FE-011）。
 *
 * 浏览器对断网、跨域被拒、DNS 失败统一抛 `TypeError: Failed to fetch`，
 * 直接把它渲染到错误卡片会让中文产品出现英文原文，且用户分不清
 * 「断网」「服务端故障」「登录过期」三种完全不同的情况。
 */
function describeTransportError(error: unknown): string | null {
  if (!(error instanceof TypeError)) return null;
  return '网络连接失败，请检查网络后重试';
}

/** 按 HTTP 状态码给出兜底文案：服务端错误与鉴权失败需要区分对待 */
function describeStatusError(status: number): string {
  if (status === 401) return '登录已失效，请重新登录';
  if (status === 403) return '没有访问权限';
  if (status === 404) return '请求的内容不存在或已被删除';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status >= 500) return '服务暂时不可用，请稍后重试';
  return `请求失败（${status}）`;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    // 断网 / DNS 失败 / 跨域被拒：浏览器只给一个 TypeError，必须换成可行动文案
    const described = describeTransportError(error);
    if (described) throw new ApiError(described, 0);
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error;
    if (res.status === 401 && !AUTH_ENDPOINTS.some((prefix) => url.startsWith(prefix))) {
      redirectToLogin();
    }
    // 服务端给了中文 error 就用服务端的；否则按状态码给兜底中文文案
    const text = msg && msg !== 'Unauthorized' ? msg : describeStatusError(res.status);
    throw new ApiError(text, res.status);
  }
  return data as T;
}

/**
 * 日期展示：同年省略年份，跨年补上年份（否则「最近导入 1月5日」无法区分是哪一年）。
 * `now` 仅为测试注入，业务调用忽略。
 */
export function formatDate(d: string | Date | null | undefined, now: Date = new Date()): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
