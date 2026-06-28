// @vectora pivot

import { getEnv } from '../config/env';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  info: RateLimitInfo;
}

const store = new Map<string, { count: number; resetAt: number }>();

export function getRateLimitOptions(): RateLimitOptions {
  const env = getEnv();
  return {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  };
}

export async function applyRateLimit(
  key: string,
  options?: Partial<RateLimitOptions>
): Promise<RateLimitResult> {
  const defaults = getRateLimitOptions();
  const opts = { ...defaults, ...options };
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return {
      allowed: true,
      info: { limit: opts.max, current: 1, remaining: opts.max - 1, resetTime: new Date(now + opts.windowMs) },
    };
  }

  entry.count += 1;
  const remaining = Math.max(0, opts.max - entry.count);

  return {
    allowed: entry.count <= opts.max,
    info: { limit: opts.max, current: entry.count, remaining, resetTime: new Date(entry.resetAt) },
  };
}

export function clearRateLimitStore(): void {
  store.clear();
}
