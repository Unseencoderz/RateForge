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
 *   baseUrl: 'http://localhost:3000',
 *   passphrase: 'my-enterprise-passphrase',
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
   * Base URL of the RateForge API gateway, e.g. `http://localhost:3000`.
   * Must NOT include a trailing slash.
   */
  baseUrl: string;

  /**
   * Enterprise admin passphrase used to exchange for a short-lived gateway JWT.
   */
  passphrase?: string;

  /**
   * Legacy JWT/API key fallback. When `passphrase` is omitted, this token is
   * forwarded as `Authorization: Bearer <apiKey>`.
   */
  apiKey?: string;

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

interface LoginResponse {
  token: string;
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

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  try {
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

function isJwtExpired(token: string): boolean {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return false;
  }

  const decoded = decodeBase64Url(payloadSegment);
  if (!decoded) {
    return false;
  }

  try {
    const payload = JSON.parse(decoded) as { exp?: number };
    if (typeof payload.exp !== 'number') {
      return false;
    }

    return payload.exp * 1_000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
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
 * - Passphrase mode caches a gateway-issued JWT between calls.
 * - Concurrent callers share a single in-flight authentication exchange.
 * - Error handling: throws a typed `SdkError` object on HTTP or network
 *   failures so callers can discriminate on `.status` or `.body.error.code`.
 */
export class RateForgeClient {
  private readonly baseUrl: string;
  private readonly passphrase?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private token?: string;
  private authenticationPromise: Promise<string> | null = null;

  constructor(options: RateForgeClientOptions) {
    if (!options.baseUrl) {
      throw new Error('[RateForgeClient] baseUrl is required.');
    }
    if (!options.passphrase && !options.apiKey) {
      throw new Error('[RateForgeClient] passphrase or apiKey is required.');
    }

    // Strip trailing slash so URL concatenation is always consistent.
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.passphrase = options.passphrase?.trim() || undefined;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  // ── Private transport ─────────────────────────────────────────────────────

  private headers(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  private async authenticate(): Promise<string> {
    if (!this.passphrase) {
      if (!this.apiKey) {
        throw new Error('[RateForgeClient] passphrase or apiKey is required.');
      }

      return this.apiKey;
    }

    if (this.token && !isJwtExpired(this.token)) {
      return this.token;
    }

    if (this.authenticationPromise) {
      return this.authenticationPromise;
    }

    this.authenticationPromise = (async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/v1/admin/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passphrase: this.passphrase }),
        },
        this.timeoutMs,
      );
      const data = await parseResponse<LoginResponse>(response);

      if (!data?.token || typeof data.token !== 'string') {
        const err: SdkError = {
          message: 'Gateway login did not return a token.',
          status: response.status,
        };
        throw err;
      }

      this.token = data.token;
      return data.token;
    })();

    try {
      return await this.authenticationPromise;
    } finally {
      this.authenticationPromise = null;
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.passphrase) {
      if (!this.token || isJwtExpired(this.token)) {
        return this.authenticate();
      }

      return this.token;
    }

    if (!this.apiKey) {
      throw new Error('[RateForgeClient] passphrase or apiKey is required.');
    }

    return this.apiKey;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    allowReauth: boolean = true,
  ): Promise<T> {
    const token = await this.ensureToken();
    const response = await fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: this.headers(token),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      this.timeoutMs,
    );

    if (response.status === 401 && allowReauth && this.passphrase) {
      this.token = undefined;
      await this.authenticate();
      return this.request<T>(method, path, body, false);
    }

    return parseResponse<T>(response);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
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
