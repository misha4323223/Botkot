import { logger } from "./logger";

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) return true;
  // Status property on OpenAI SDK errors
  const anyErr = err as { status?: number };
  if (typeof anyErr?.status === "number" && (anyErr.status === 429 || anyErr.status >= 500)) return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 800;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
      logger.warn({ attempt: attempt + 1, retries, delay }, "OpenAI call failed, retrying");
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
