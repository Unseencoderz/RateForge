import { SlidingWindowLog } from './sliding-window';

describe('SlidingWindowLog', () => {
  const makeNow = (start = 1000) => {
    let t = start;
    return {
      now: () => t,
      advance: (ms: number) => { t += ms; }
    };
  };

  // ── basic operation ───────────────────────────────────────────────────────

  describe('basic operation', () => {
    it('first request is allowed', () => {
      const clock = makeNow();
      const sw = new SlidingWindowLog({ limit: 3, windowMs: 1000, now: clock.now });
      expect(sw.check('k').allowed).toBe(true);
    });

    it('requests up to limit are allowed', () => {
      const clock = makeNow();
      const sw = new SlidingWindowLog({ limit: 3, windowMs: 1000, now: clock.now });
      for (let i = 0; i < 3; i++) {
        expect(sw.check('k').allowed).toBe(true);
      }
    });

    it('request at limit+1 is blocked', () => {
      const clock = makeNow();
      const sw = new SlidingWindowLog({ limit: 2, windowMs: 1000, now: clock.now });
      sw.check('k'); sw.check('k');
      expect(sw.check('k').allowed).toBe(false);
    });

    it('reason on block is SLIDING_WINDOW_EXCEEDED', () => {
      const clock = makeNow();
      const sw = new SlidingWindowLog({ limit: 1, windowMs: 1000, now: clock.now });
      sw.check('k');
      expect(sw.check('k').reason).toBe('SLIDING_WINDOW_EXCEEDED');
    });
  });

  // ── sliding precision ─────────────────────────────────────────────────────

  describe('sliding precision', () => {
    it('a request that falls just outside the window boundary is pruned, freeing capacity', () => {
      // window = 1000ms, limit = 1
      // t=0: request allowed (ts=0 saved)
      // t=1001: ts=0 is now > 1001ms in the past (threshold = 1001-1000=1), so ts=0 is pruned
      const clock = makeNow(0);
      const sw = new SlidingWindowLog({ limit: 1, windowMs: 1000, now: clock.now });
      sw.check('k'); // ts=0
      clock.advance(1001);
      expect(sw.check('k').allowed).toBe(true); // ts=0 pruned
    });

    it('a request exactly at the boundary (ts === now - windowMs) is pruned', () => {
      // threshold = now - windowMs; filter condition is ts > threshold
      // ts === threshold means ts is NOT > threshold → pruned
      const clock = makeNow(0);
      const sw = new SlidingWindowLog({ limit: 1, windowMs: 1000, now: clock.now });
      sw.check('k'); // ts=0
      clock.advance(1000); // threshold = 1000-1000=0; ts=0 is NOT > 0 → pruned
      expect(sw.check('k').allowed).toBe(true);
    });

    it('two requests at different timestamps are both counted within the window', () => {
      const clock = makeNow(0);
      const sw = new SlidingWindowLog({ limit: 3, windowMs: 2000, now: clock.now });
      sw.check('k'); // ts=0
      clock.advance(500);
      sw.check('k'); // ts=500
      clock.advance(500); // now=1000; threshold=1000-2000=-1000; both still in window
      // 2 in window, limit=3, so 3rd is allowed
      expect(sw.check('k').allowed).toBe(true);
    });
  });

  // ── memory cleanup ────────────────────────────────────────────────────────

  describe('memory cleanup', () => {
    it('old timestamps are pruned on every check (log never grows beyond limit entries)', () => {
      const clock = makeNow(0);
      const sw = new SlidingWindowLog({ limit: 3, windowMs: 100, now: clock.now });
      // Fill to limit
      sw.check('k'); sw.check('k'); sw.check('k');
      clock.advance(200); // all old timestamps expire
      // Next check should prune and allow
      const result = sw.check('k');
      expect(result.allowed).toBe(true);
      // remaining should be 2 (1 entry just added, limit=3)
      expect(result.remaining).toBe(2);
    });
  });

  // ── multi-key isolation ───────────────────────────────────────────────────

  describe('multi-key isolation', () => {
    it('exhausting key A does not affect key B', () => {
      const clock = makeNow();
      const sw = new SlidingWindowLog({ limit: 2, windowMs: 1000, now: clock.now });
      sw.check('A'); sw.check('A'); // exhaust A
      expect(sw.check('B').allowed).toBe(true);
    });
  });
});
