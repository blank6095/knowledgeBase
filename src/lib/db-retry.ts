/**
 * 数据库瞬时故障处理（仅用于只读路径）。
 *
 * 背景：Neon HTTP 驱动每次查询都是一次 fetch，实测会出现
 * `Error connecting to database: TypeError: fetch failed`（cause: AggregateError / ETIMEDOUT）
 * 这类瞬时网络故障——同一端点紧接着重试即 200，属于「连接抖动」而非查询错误。
 * 若直接冒泡，前端就会看到整页 500 与空白界面。
 *
 * 三层处置（由内到外）：
 * 1. withDbRetry：对幂等的只读查询做指数退避重试；
 * 2. withStaleFallback：重试仍失败时，回退到「上一次成功结果」的陈旧快照；
 * 3. 路由兜底：连陈旧快照都没有时返回 503 + 中文可操作提示，前端展示可重试错误态。
 *
 * 纪律：写路径一律不走本模块——写入重试可能造成重复或半写状态。
 */

/** 明确属于瞬时故障的系统错误码（可安全重试） */
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/** 明确属于配置/认证问题的错误码：重试没有意义，直接上抛 */
const FATAL_CODES = new Set(['ENOTFOUND', 'EACCES', 'EPERM', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT']);

/** 瞬时故障的特征文案（Neon / undici 的常见表述） */
const TRANSIENT_PATTERNS = [
  /fetch failed/i,
  /socket hang up/i,
  /connection terminated/i,
  /connection closed/i,
  /connection reset/i,
  /service unavailable/i,
  /too many connections/i,
  /server is not available/i,
  /timeout exceeded/i,
  /timed out/i,
];

/** 收集错误链上的所有 code 与 message（含 AggregateError.errors 与 error.cause） */
function collectSignals(error: unknown, depth = 0, out: string[] = []): string[] {
  if (!error || depth > 5) return out;
  if (typeof error === 'string') {
    out.push(error);
    return out;
  }
  const err = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown[] };
  if (typeof err.code === 'string') out.push(err.code);
  if (typeof err.message === 'string') out.push(err.message);
  if (Array.isArray(err.errors)) for (const item of err.errors) collectSignals(item, depth + 1, out);
  if (err.cause) collectSignals(err.cause, depth + 1, out);
  return out;
}

/** 是否为「重试可能成功」的瞬时故障 */
export function isTransientDbError(error: unknown): boolean {
  const signals = collectSignals(error);
  if (signals.length === 0) return false;
  // 配置类错误优先判定：例如 fetch failed 但根因是 DNS 解析失败
  if (signals.some((s) => FATAL_CODES.has(s.toUpperCase()))) return false;
  if (signals.some((s) => TRANSIENT_CODES.has(s.toUpperCase()))) return true;
  return signals.some((s) => TRANSIENT_PATTERNS.some((p) => p.test(s)));
}

/** 把错误压缩成一行可读文案（用于日志与 503 提示）：优先暴露根因而非外层包装 */
export function describeDbError(error: unknown): string {
  const signals = collectSignals(error);
  const code = signals.find((s) => /^[A-Z_]+$/.test(s)) ?? '';
  // Drizzle 会把底层错误包成 "Failed query: ..."，真正有用的信息在更内层
  const specific = signals.find(
    (s) => TRANSIENT_CODES.has(s.toUpperCase()) || TRANSIENT_PATTERNS.some((p) => p.test(s)),
  );
  const message =
    specific ?? signals.find((s) => s.length > 6 && !/^[A-Z_]+$/.test(s)) ?? signals[0] ?? '未知错误';
  return code ? `${code}: ${message}` : message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DbRetryOptions {
  /** 额外重试次数（0 表示不重试）；默认取环境变量 DB_RETRY_ATTEMPTS，缺省 2 */
  retries?: number;
  /** 首次退避基数（ms）；默认取环境变量 DB_RETRY_BASE_DELAY_MS，缺省 250 */
  baseDelayMs?: number;
  /** 单次退避上限（ms），默认 2000 */
  maxDelayMs?: number;
  /** 日志标签，用于定位是哪个查询在重试 */
  label?: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * 对幂等的只读查询做指数退避重试。
 * 非瞬时错误立即上抛；瞬时错误重试到上限后仍失败，则抛出最后一次错误。
 */
export async function withDbRetry<T>(fn: () => Promise<T>, options: DbRetryOptions = {}): Promise<T> {
  const retries = Math.max(0, options.retries ?? envInt('DB_RETRY_ATTEMPTS', 2));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? envInt('DB_RETRY_BASE_DELAY_MS', 250));
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2000);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && isTransientDbError(error);
      if (!canRetry) break;
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs) + Math.floor(Math.random() * 100);
      if (options.label) {
        console.warn(
          `[db-retry] ${options.label} 第 ${attempt + 1} 次失败（${describeDbError(error)}），${delay}ms 后重试`,
        );
      }
      await sleep(delay);
    }
  }
  throw lastError;
}
