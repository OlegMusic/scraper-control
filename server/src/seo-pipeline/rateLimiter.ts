/**
 * Global token bucket для rate-limit'а autocomplete запросов.
 * Default 60/min — Google Autocomplete банит ≥100 req/IP в час, поэтому
 * 60/min с одного IP даёт ~1 час непрерывной работы до бана. Для job'ов >1000
 * провайдеров автоматически включается IPRoyal residential proxy (rotating).
 *
 * Singleton — один bucket на весь процесс. Несколько одновременных bulk-job'ов
 * сериализуются через него.
 */

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async take(n = 1): Promise<void> {
    if (n > this.capacity) {
      throw new Error(`take(${n}) exceeds bucket capacity ${this.capacity}`);
    }
    while (true) {
      this.refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      const deficit = n - this.tokens;
      const waitMs = Math.ceil((deficit / (this.perMinute / 60)) * 1000);
      await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
    }
  }

  private refill() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSec * (this.perMinute / 60);
    if (tokensToAdd >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  status() {
    this.refill();
    return { tokens: Math.floor(this.tokens), capacity: this.capacity, perMinute: this.perMinute };
  }
}

export const autocompleteBucket = new TokenBucket(60, 60);

/** Convenience wrapper. Awaits a token, then calls fn. */
export async function withAutocompleteSlot<T>(fn: () => Promise<T>): Promise<T> {
  await autocompleteBucket.take(1);
  return fn();
}
