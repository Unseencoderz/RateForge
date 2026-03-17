import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  const makeNow = (start = 1000) => {
    let t = start;
    return {
      now: () => t,
      advance: (ms: number) => { t += ms; }
    };
  };

  // ── initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('a brand-new key starts with exactly capacity tokens (NOT capacity + any burst)', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 60, windowMs: 60_000, now: clock.now });
      // consume 60 — should all succeed
      for (let i = 0; i < 60; i++) {
        expect(bucket.consume('k', 1).allowed).toBe(true);
      }
      // 61st should fail
      expect(bucket.consume('k', 1).allowed).toBe(false);
    });

    it('a brand-new key with burstCapacity set still starts with exactly capacity tokens', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 10, windowMs: 1000, burstCapacity: 20, now: clock.now });
      for (let i = 0; i < 10; i++) {
        expect(bucket.consume('k', 1).allowed).toBe(true);
      }
      expect(bucket.consume('k', 1).allowed).toBe(false);
    });
  });

  // ── consume — allowed ─────────────────────────────────────────────────────

  describe('consume — allowed', () => {
    it('first consume on a new key with cost=1 succeeds and returns allowed: true', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, now: clock.now });
      const result = bucket.consume('key', 1);
      expect(result.allowed).toBe(true);
    });

    it('remaining decrements by cost', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 10, windowMs: 1000, now: clock.now });
      bucket.consume('k', 3);
      const result = bucket.consume('k', 1);
      expect(result.remaining).toBe(6);
    });

    it('remaining never goes below 0', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 2, windowMs: 1000, now: clock.now });
      bucket.consume('k', 2); // drain
      const result = bucket.consume('k', 1); // blocked
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('limit equals capacity', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 42, windowMs: 1000, now: clock.now });
      const result = bucket.consume('k', 1);
      expect(result.limit).toBe(42);
    });

    it('resetAt is approximately lastRefill + windowMs', () => {
      const clock = makeNow(5000);
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, now: clock.now });
      const result = bucket.consume('k', 1);
      expect(result.resetAt).toBe(5000 + 1000);
    });
  });

  // ── consume — blocked ─────────────────────────────────────────────────────

  describe('consume — blocked', () => {
    it('consume fails when tokens < cost and returns allowed: false', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 3, windowMs: 1000, now: clock.now });
      bucket.consume('k', 3);
      expect(bucket.consume('k', 1).allowed).toBe(false);
    });

    it('reason is TOKEN_BUCKET_EXHAUSTED', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 1, windowMs: 1000, now: clock.now });
      bucket.consume('k', 1);
      const result = bucket.consume('k', 1);
      expect(result.reason).toBe('TOKEN_BUCKET_EXHAUSTED');
    });

    it('remaining is 0 when fully exhausted', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 2, windowMs: 1000, now: clock.now });
      bucket.consume('k', 2);
      expect(bucket.consume('k', 1).remaining).toBe(0);
    });

    it('retryAfterMs is > 0 when blocked', () => {
      const clock = makeNow(1000);
      const bucket = new TokenBucket({ capacity: 1, windowMs: 2000, now: clock.now });
      bucket.consume('k', 1);
      const result = bucket.consume('k', 1);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });

  // ── refill ────────────────────────────────────────────────────────────────

  describe('refill', () => {
    it('advancing time by windowMs refills capacity tokens exactly', () => {
      const clock = makeNow(0);
      const bucket = new TokenBucket({ capacity: 10, windowMs: 1000, now: clock.now });
      // drain
      for (let i = 0; i < 10; i++) bucket.consume('k', 1);
      clock.advance(1000);
      // should now have 10 tokens again
      for (let i = 0; i < 10; i++) {
        expect(bucket.consume('k', 1).allowed).toBe(true);
      }
      expect(bucket.consume('k', 1).allowed).toBe(false);
    });

    it('tokens do not exceed capacity when no burstCapacity is set', () => {
      const clock = makeNow(0);
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, now: clock.now });
      clock.advance(5000); // way more than one window
      const result = bucket.consume('k', 1);
      // remaining after 1 consume should be 4 (capped at capacity=5)
      expect(result.remaining).toBe(4);
    });

    it('tokens do not exceed burstCapacity when burstCapacity > capacity', () => {
      const clock = makeNow(0);
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, burstCapacity: 8, now: clock.now });
      // drain to 0
      for (let i = 0; i < 5; i++) bucket.consume('k', 1);
      clock.advance(2000); // refill 10 tokens worth, but ceil is 8
      const result = bucket.consume('k', 1);
      expect(result.remaining).toBe(7); // 8 - 1 = 7
    });

    it('partial time elapsed refills proportionally', () => {
      const clock = makeNow(0);
      // capacity=10, window=1000ms → 0.01 tokens/ms
      // drain 10, advance 500ms → refill 5
      const bucket = new TokenBucket({ capacity: 10, windowMs: 1000, now: clock.now });
      for (let i = 0; i < 10; i++) bucket.consume('k', 1);
      clock.advance(500);
      const result = bucket.consume('k', 1);
      expect(result.allowed).toBe(true);
      // 5 refilled - 1 consumed = 4
      expect(result.remaining).toBe(4);
    });
  });

  // ── multi-key isolation ───────────────────────────────────────────────────

  describe('multi-key isolation', () => {
    it('consuming from key A does not affect key B', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 3, windowMs: 1000, now: clock.now });
      bucket.consume('A', 3);
      expect(bucket.consume('B', 1).allowed).toBe(true);
    });

    it('two keys can be independently exhausted', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 2, windowMs: 1000, now: clock.now });
      bucket.consume('A', 2);
      bucket.consume('B', 2);
      expect(bucket.consume('A', 1).allowed).toBe(false);
      expect(bucket.consume('B', 1).allowed).toBe(false);
    });
  });

  // ── burst capacity ────────────────────────────────────────────────────────

  describe('burst capacity', () => {
    it('constructing with burstCapacity: 0 blocks all requests immediately', () => {
      const clock = makeNow(0);
      const bucket = new TokenBucket({ capacity: 10, windowMs: 1000, burstCapacity: 0, now: clock.now });
      // Initial tokens = capacity (10), but refill ceiling is 0.
      // First check: getBucket creates bucket with tokens=10, then consume should work.
      // The burstCapacity only limits refill ceiling, not initial fill.
      // After draining, no refill happens.
      for (let i = 0; i < 10; i++) bucket.consume('k', 1);
      clock.advance(500); // refill happens but is capped at burstCapacity=0
      expect(bucket.consume('k', 1).allowed).toBe(false);
    });

    it('constructing with burstCapacity > capacity allows tokens to refill up to burstCapacity', () => {
      const clock = makeNow(0);
      // capacity=5 tokens per 1000ms, burstCapacity=10
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, burstCapacity: 10, now: clock.now });
      for (let i = 0; i < 5; i++) bucket.consume('k', 1); // drain initial
      clock.advance(2000); // refill = 10 tokens, but cap is burstCapacity=10
      const result = bucket.consume('k', 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 - 1
    });
  });

  // ── check() alias ─────────────────────────────────────────────────────────

  describe('check() interface', () => {
    it('check() delegates to consume() and returns same shape', () => {
      const clock = makeNow();
      const bucket = new TokenBucket({ capacity: 5, windowMs: 1000, now: clock.now });
      const r = bucket.check('k', 1);
      expect(r.allowed).toBe(true);
      expect(r.limit).toBe(5);
    });
  });
});
