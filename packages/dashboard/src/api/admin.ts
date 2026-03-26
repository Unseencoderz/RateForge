import { normaliseGatewayUrl } from '../lib/settings';

import type { RuleConfig } from '@rateforge/types';

interface RequestOptions {
  adminPassphrase: string;
  gatewayUrl: string;
}

interface AdminSession {
  gatewayUrl: string;
  passphrase: string;
  token: string;
}

interface LoginResponse {
  data?: {
    token?: string;
  };
  error?: {
    message?: string;
  };
}

interface RulesResponse {
  data?: RuleConfig[];
  error?: {
    message?: string;
  };
}

let adminSession: AdminSession | null = null;

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  try {
    return window.atob(padded);
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

function buildHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token.trim()}`,
    'Content-Type': 'application/json',
  };
}

function assertAdminAccess(options: RequestOptions): void {
  if (!options.gatewayUrl.trim()) {
    throw new Error('Save a gateway URL before requesting admin data.');
  }

  if (!options.adminPassphrase.trim()) {
    throw new Error('Save an admin passphrase before requesting admin data.');
  }
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function clearAdminSession(): void {
  adminSession = null;
}

async function authenticateAdmin(options: RequestOptions): Promise<string> {
  assertAdminAccess(options);

  const gatewayUrl = normaliseGatewayUrl(options.gatewayUrl);
  const passphrase = options.adminPassphrase.trim();
  const response = await fetch(`${gatewayUrl}/api/v1/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ passphrase }),
  });

  const rawBody = await readResponseBody(response);
  const parsed = rawBody ? (JSON.parse(rawBody) as LoginResponse) : {};

  if (!response.ok) {
    const message =
      parsed.error?.message ??
      (rawBody ? rawBody : `Admin login failed with HTTP ${response.status}.`);
    throw new Error(message);
  }

  const token = parsed.data?.token?.trim();
  if (!token) {
    throw new Error('Admin login did not return a token.');
  }

  adminSession = {
    gatewayUrl,
    passphrase,
    token,
  };

  return token;
}

async function getAdminToken(options: RequestOptions): Promise<string> {
  assertAdminAccess(options);

  const gatewayUrl = normaliseGatewayUrl(options.gatewayUrl);
  const passphrase = options.adminPassphrase.trim();

  if (
    adminSession &&
    adminSession.gatewayUrl === gatewayUrl &&
    adminSession.passphrase === passphrase &&
    !isJwtExpired(adminSession.token)
  ) {
    return adminSession.token;
  }

  return authenticateAdmin({
    gatewayUrl,
    adminPassphrase: passphrase,
  });
}

async function requestRules(
  path: string,
  options: RequestOptions,
  init?: RequestInit,
  allowReauth: boolean = true,
): Promise<RuleConfig[]> {
  assertAdminAccess(options);

  const response = await fetch(`${normaliseGatewayUrl(options.gatewayUrl)}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(await getAdminToken(options)),
      ...(init?.headers ?? {}),
    },
  });

  const rawBody = await readResponseBody(response);
  const parsed = rawBody ? (JSON.parse(rawBody) as RulesResponse) : {};

  if (response.status === 401 && allowReauth) {
    clearAdminSession();
    return requestRules(path, options, init, false);
  }

  if (!response.ok) {
    const message =
      parsed.error?.message ??
      (rawBody ? rawBody : `Admin request failed with HTTP ${response.status}.`);
    throw new Error(message);
  }

  return parsed.data ?? [];
}

export async function fetchRules(options: RequestOptions): Promise<RuleConfig[]> {
  return requestRules('/api/v1/admin/rules', options);
}

export async function replaceRules(
  options: RequestOptions,
  rules: RuleConfig[],
): Promise<RuleConfig[]> {
  return requestRules('/api/v1/admin/rules', options, {
    method: 'POST',
    body: JSON.stringify({ rules }),
  });
}
