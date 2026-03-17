import { FixedWindowCounter } from './fixed-window';

describe('FixedWindowCounter', () => {
  const makeNow = (start = 1000) => {
    let t = start;
    return {
      now: () => t,
      advance: (ms: number) => { t += ms; }
    };
  };

  // ── within a window ───────────────────────────────────────────────────────

  describe('within a window', () => {
    it('first request is allowed', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 5, windowMs: 1000, now: clock.now });
      expect(fw.check('k').allowed).toBe(true);
    });

    it('requests up to limit are allowed', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 5, windowMs: 1000, now: clock.now });
      for (let i = 0; i < 5; i++) {
        expect(fw.check('k').allowed).toBe(true);
      }
    });

    it('request at limit+1 is blocked with allowed: false', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 3, windowMs: 1000, now: clock.now });
      fw.check('k'); fw.check('k'); fw.check('k');
      expect(fw.check('k').allowed).toBe(false);
    });

    it('reason on block is FIXED_WINDOW_EXCEEDED', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 1, windowMs: 1000, now: clock.now });
      fw.check('k');
      expect(fw.check('k').reason).toBe('FIXED_WINDOW_EXCEEDED');
    });

    it('remaining decrements correctly', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 5, windowMs: 1000, now: clock.now });
      fw.check('k'); // remaining = 4
      fw.check('k'); // remaining = 3
      expect(fw.check('k').remaining).toBe(2);
    });

    it('remaining is 0 when at limit', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 3, windowMs: 1000, now: clock.now });
      fw.check('k'); fw.check('k'); fw.check('k');
      const result = fw.check('k'); // blocked
      expect(result.remaining).toBe(0);
    });
  });

  // ── window boundary ───────────────────────────────────────────────────────

  describe('window boundary', () => {
    it('counter resets when window expires (now >= windowStart + windowMs)', () => {
      const clock = makeNow(0);
      const fw = new FixedWindowCounter({ limit: 2, windowMs: 1000, now: clock.now });
      fw.check('k'); fw.check('k'); // exhaust
      clock.advance(1000); // window expires
      expect(fw.check('k').allowed).toBe(true);
    });

    it('after reset, first request is allowed again', () => {
      const clock = makeNow(0);
      const fw = new FixedWindowCounter({ limit: 1, windowMs: 500, now: clock.now });
      fw.check('k'); // exhaust
      clock.advance(500);
      expect(fw.check('k').allowed).toBe(true);
    });

    it('requests in old window do not count toward new window', () => {
      const clock = makeNow(0);
      const fw = new FixedWindowCounter({ limit: 3, windowMs: 1000, now: clock.now });
      fw.check('k'); fw.check('k'); fw.check('k'); // exhaust
      clock.advance(1000); // new window
      // should now have full 3 slots
      for (let i = 0; i < 3; i++) {
        expect(fw.check('k').allowed).toBe(true);
      }
      expect(fw.check('k').allowed).toBe(false);
    });
  });

  // ── multi-key isolation ───────────────────────────────────────────────────

  describe('multi-key isolation', () => {
    it('exhausting key A does not affect key B', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 2, windowMs: 1000, now: clock.now });
      fw.check('A'); fw.check('A'); // exhaust A
      expect(fw.check('B').allowed).toBe(true);
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('limit=1 blocks second request immediately', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 1, windowMs: 1000, now: clock.now });
      fw.check('k');
      expect(fw.check('k').allowed).toBe(false);
    });

    it('limit=0 blocks all requests', () => {
      const clock = makeNow();
      const fw = new FixedWindowCounter({ limit: 0, windowMs: 1000, now: clock.now });
      expect(fw.check('k').allowed).toBe(false);
    });
  });
});
