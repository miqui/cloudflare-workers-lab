import { DurableObject } from 'cloudflare:workers';

type Bindings = Cloudflare.Env;

interface WindowState {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class RateLimiter extends DurableObject<Bindings> {
  async consume(limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const state = (await this.ctx.storage.get<WindowState>('state')) ?? {
      count: 0,
      windowStart: now,
    };

    let { count, windowStart } = state;
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }

    count += 1;
    await this.ctx.storage.put<WindowState>('state', { count, windowStart });
    await this.ctx.storage.setAlarm(windowStart + windowMs);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: windowStart + windowMs,
    };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
