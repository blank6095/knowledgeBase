const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const MAX_KEYS = 1_000;

interface Attempt {
  failures: number;
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

function prune(now: number): void {
  for (const [key, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_KEYS) {
    const oldest = attempts.keys().next().value;
    if (!oldest) break;
    attempts.delete(oldest);
  }
}

export function loginRateLimit(key: string, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
  const attempt = attempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    if (attempt) attempts.delete(key);
    return { blocked: false, retryAfterSec: 0 };
  }
  return {
    blocked: attempt.failures >= MAX_FAILURES,
    retryAfterSec: Math.max(1, Math.ceil((attempt.resetAt - now) / 1000)),
  };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  prune(now);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.failures += 1;
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

export function clientLoginKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function clearAllLoginRateLimits(): void {
  attempts.clear();
}
