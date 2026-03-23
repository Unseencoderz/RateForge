import { REDIS_URL } from '@rateforge/config';
import { RULES_UPDATE_CHANNEL } from '@rateforge/types';
import IORedis from 'ioredis';

import { loadRules } from './rules-loader';

import type { RuleConfig } from '@rateforge/types';

export { RULES_UPDATE_CHANNEL } from '@rateforge/types';

// ── Callback type ─────────────────────────────────────────────────────────────

/**
 * Called every time the watcher successfully reloads rules.
 *
 * The gateway wires this to `setRules()` in `RateLimitService` so the new
 * rule set is active for all requests that arrive after the callback returns.
 */
export type OnRulesReloaded = (rules: RuleConfig[]) => void;

/**
 * Called when a reload attempt fails (bad JSON, schema error, etc.).
 *
 * ⚠️  Unlike startup failures, hot-reload errors do NOT call `process.exit`.
 *     Stopping the gateway on a bad hot-reload would be worse than keeping
 *     the current (valid) rule set active.  Log the error and alert instead.
 */
export type OnReloadError = (err: unknown) => void;

// ── Watcher options ───────────────────────────────────────────────────────────

export interface RulesWatcherOptions {
  /** Override the rules file path (defaults to `getRulesPath()`). */
  rulesPath?: string;
  /** Called after each successful reload with the new RuleConfig[]. */
  onReloaded: OnRulesReloaded;
  /** Called when a reload attempt throws (default: logs to console.error). */
  onError?: OnReloadError;
}

// ── Watcher handle ────────────────────────────────────────────────────────────

export interface RulesWatcherHandle {
  /** Unsubscribe from the channel and quit the subscriber connection. */
  stop: () => Promise<void>;
  /** The underlying subscriber Redis instance (exposed for testing). */
  subscriber: IORedis;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * P2-M4-T2 · Redis Pub/Sub hot-reload watcher.
 *
 * Opens a **dedicated** IORedis subscriber connection (a client in subscribe
 * mode cannot execute normal commands — using the shared client here would
 * break all other Redis operations).
 *
 * Lifecycle:
 *   1. Subscribe to `rateforge:rules:update`.
 *   2. On each message → call `loadRules()` → call `onReloaded(newRules)`.
 *   3. On any reload error → call `onError(err)` (no process.exit).
 *   4. `stop()` unsubscribes and disconnects the dedicated subscriber.
 *
 * Usage (wired in app.ts after startup loadRules):
 * ```ts
 * const handle = startRulesWatcher({
 *   onReloaded: (rules) => setRules(rules),  // update RateLimitService
 * });
 * // On SIGTERM:
 * await handle.stop();
 * ```
 */
export function startRulesWatcher(options: RulesWatcherOptions): RulesWatcherHandle {
  const { rulesPath, onReloaded, onError } = options;

  const defaultOnError: OnReloadError = (err) => {
    console.error(
      '[rules-watcher] Hot-reload failed — keeping existing rules active.\n',
      err instanceof Error ? err.message : String(err),
    );
  };

  const handleError = onError ?? defaultOnError;

  // ── Dedicated subscriber connection ─────────────────────────────────────────
  //
  // IORedis in subscribe mode cannot run regular commands (GET, SET, etc.).
  // Creating a separate instance is the correct pattern.
  const subscriber = new IORedis(REDIS_URL, {
    // Subscriber connections should not time out while idle.
    maxRetriesPerRequest: null,
    // Keep trying to reconnect so a brief Redis outage doesn't permanently
    // disable hot-reload. The gateway keeps running with stale rules.
    retryStrategy(times: number) {
      const delay = Math.min(times * 300, 10_000);
      console.warn(
        `[rules-watcher] Redis subscriber reconnect attempt ${times}, ` + `retrying in ${delay}ms…`,
      );
      return delay;
    },
  });

  // ── Subscribe ───────────────────────────────────────────────────────────────

  subscriber.subscribe(RULES_UPDATE_CHANNEL, (err, count) => {
    if (err) {
      handleError(
        new Error(
          `[rules-watcher] Failed to subscribe to "${RULES_UPDATE_CHANNEL}": ${err.message}`,
        ),
      );
      return;
    }
    console.info(
      `[rules-watcher] Subscribed to "${RULES_UPDATE_CHANNEL}" ` +
        `(active subscriptions: ${count}).`,
    );
  });

  // ── Message handler ─────────────────────────────────────────────────────────

  subscriber.on('message', (channel: string, _message: string) => {
    if (channel !== RULES_UPDATE_CHANNEL) {
      return; // defensive: ignore unrelated channels
    }

    console.info('[rules-watcher] Reload signal received — reloading rules…');

    try {
      // loadRules() calls process.exit on startup failures; during hot-reload
      // we catch any thrown errors (including the mocked process.exit in tests)
      // and route them through onError so the gateway stays up.
      const newRules = loadRules(rulesPath);
      console.info(
        `[rules-watcher] Rules reloaded successfully (${newRules.length} rule(s) active).`,
      );
      onReloaded(newRules);
    } catch (err) {
      handleError(err);
    }
  });

  // ── Error guard ─────────────────────────────────────────────────────────────

  subscriber.on('error', (err: Error) => {
    console.error('[rules-watcher] Subscriber connection error:', err.message);
    // Do not re-throw — IORedis will attempt to reconnect automatically.
  });

  // ── Stop / cleanup ──────────────────────────────────────────────────────────

  const stop = async (): Promise<void> => {
    await subscriber.unsubscribe(RULES_UPDATE_CHANNEL);
    subscriber.disconnect();
    console.info('[rules-watcher] Stopped.');
  };

  return { stop, subscriber };
}
