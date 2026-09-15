import { ApiError } from './api-errors.js';

export interface RideLimits {
  accountPerMinute: number;
  ipPerMinute: number;
}

// Single-process development/beta guard. A multi-instance deployment needs a shared limiter.
export class RideLimiter {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly limits: RideLimits,
    private readonly clock: () => number = Date.now,
    private readonly capacity = 10000,
  ) {}

  consume(kind: 'ip' | 'account', identifier: string): number | null {
    const now = this.clock();
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
    const key = `${kind}:${identifier}`;
    const limit = kind === 'ip' ? this.limits.ipPerMinute : this.limits.accountPerMinute;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.capacity) return 60;
      bucket = { count: 0, expiresAt: now + 60000 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    bucket.count += 1;
    return null;
  }
}

export function rateLimited(): ApiError {
  return new ApiError(429, 'RATE_LIMITED', 'Too many invitation requests. Wait and try again.');
}
