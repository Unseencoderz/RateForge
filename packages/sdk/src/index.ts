/**
 * @rateforge/sdk — P3-M1-T1
 *
 * Thin HTTP wrapper around the RateForge API gateway.
 * This package intentionally has zero runtime dependencies beyond
 * `@rateforge/types` — it never imports Express, Redis, or any server-side
 * module. The only transport primitive used is the global `fetch` (Node ≥ 18).
 *
 * Usage:
 * ```ts
 * import { RateForgeClient } from '@rateforge/sdk';
 *
 * const client = new RateForgeClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'my-jwt-or-api-key',
 * });
 *
 * const result = await client.checkLimit(req);
 * const rules  = await client.getRules();
 * await client.resetLimit('user-123');
 * ```
 */

import type {
  RateLimitRequest,
  RateLimitResult,
  RuleConfig,
  ApiResponse,
  ResetClientResponse,
} from '@rateforge/types';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RateForgeClientOptions {
  /**
   * Base URL of the RateForge API gateway, e.g. `http://localhost:3001`.
   * Must NOT include a trailing slash.
   */
  baseUrl: string;

  /**
   * JWT or API key that is forwarded as the `Authorization: Bearer <apiKey>`
   * header on every request.
   */
  apiKey: string;

  /**
   * Per-request timeout in milliseconds. Defaults to 5000.
   */
  timeoutMs?: number;
}

export interface SdkError {
  /** Human-readable description of what went wrong. */
  message: string;
  /** HTTP status code, if the error came from the server. */
  status?: number;
  /** Structured error body returned by the gateway, if available. */
  body?: ApiResponse<never>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Wraps the native `fetch` with a timeout via `AbortController`.
 * Always resolves; throws only on genuine network errors.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses a JSON response body and throws a structured `SdkError` if the
 * HTTP status is not 2xx or if the gateway returned `success: false`.
 */
async function parseResponse<T>(response: Response): Promise<T> {
  let body: ApiResponse<T> | undefined;

  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    // Response was not JSON (shouldn't happen with a conforming gateway).
    const err: SdkError = {
      message: `Non-JSON response from gateway (HTTP ${response.status})`,
      status: response.status,
    };
    throw err;
  }

  if (!response.ok || body?.success === false) {
    const err: SdkError = {
      message: body?.error?.message ?? `Gateway returned HTTP ${response.status}`,
      status: response.status,
      body: body as ApiResponse<never>,
    };
    throw err;
  }

  // `data` is guaranteed to be present when `success === true`.
  return body.data as T;
}

// ── RateForgeClient ───────────────────────────────────────────────────────────

/**
 * P3-M1-T1 · `RateForgeClient`
 *
 * Thin HTTP client for the RateForge API gateway. Exposes one method per
 * gateway endpoint so callers never construct raw `fetch` calls themselves.
 *
 * Design constraints (from DevPlan):
 * - Never imports Express, Redis, or any server-side runtime.
 * - All state is held in the constructor options — instances are stateless
 *   between calls and are safe to share across async contexts.
 * - Error handling: throws a typed `SdkError` object on HTTP or network
 *   failures so callers can discriminate on `.status` or `.body.error.code`.
 */
export class RateForgeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: RateForgeClientOptions) {
    if (!options.baseUrl) {
      throw new Error('[RateForgeClient] baseUrl is required.');
    }
    if (!options.apiKey) {
      throw new Error('[RateForgeClient] apiKey is required.');
    }

    // Strip trailing slash so URL concatenation is always consistent.
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  // ── Private transport ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      { method: 'GET', headers: this.headers() },
      this.timeoutMs,
    );
    return parseResponse<T>(response);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      this.timeoutMs,
    );
    return parseResponse<T>(response);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * P3-M1-T2 · Check whether a request is within the rate limit.
   *
   * Maps to: `POST /api/v1/check`
   *
   * @throws {SdkError} on network failure or non-2xx gateway response.
   */
  async checkLimit(req: RateLimitRequest): Promise<RateLimitResult> {
    return this.post<RateLimitResult>('/api/v1/check', req);
  }

  /**
   * P3-M1-T3 · Delete all Redis counters for the given clientId so the
   * client starts fresh on its next request.
   *
   * Maps to: `POST /api/v1/admin/reset/:clientId`
   *
   * @throws {SdkError} on network failure or non-2xx gateway response.
   */
  async resetLimit(clientId: string): Promise<ResetClientResponse> {
    if (!clientId || clientId.trim() === '') {
      throw new Error('[RateForgeClient] resetLimit: clientId must be a non-empty string.');
    }
    return this.post<ResetClientResponse>(`/api/v1/admin/reset/${encodeURIComponent(clientId)}`);
  }

  /**
   * P3-M1-T3 · Return the currently active rule set as seen by the gateway.
   *
   * Maps to: `GET /api/v1/admin/rules`
   *
   * @throws {SdkError} on network failure or non-2xx gateway response.
   */
  async getRules(): Promise<RuleConfig[]> {
    return this.get<RuleConfig[]>('/api/v1/admin/rules');
  }
}

// ── Re-export shared types so consumers don't need a separate import ──────────

export type {
  RateLimitRequest,
  RateLimitResult,
  RuleConfig,
  ApiResponse,
  ResetClientResponse,
} from '@rateforge/types';
