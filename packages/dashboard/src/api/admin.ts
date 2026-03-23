import { normaliseGatewayUrl } from '../lib/settings';

import type { RuleConfig } from '@rateforge/types';

interface RequestOptions {
  adminToken: string;
  gatewayUrl: string;
}

interface RulesResponse {
  data?: RuleConfig[];
  error?: {
    message?: string;
  };
}

function buildHeaders(adminToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${adminToken.trim()}`,
    'Content-Type': 'application/json',
  };
}

function assertAdminAccess(options: RequestOptions): void {
  if (!options.gatewayUrl.trim()) {
    throw new Error('Save a gateway URL before requesting admin data.');
  }

  if (!options.adminToken.trim()) {
    throw new Error('Save an admin JWT before requesting admin data.');
  }
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function requestRules(
  path: string,
  options: RequestOptions,
  init?: RequestInit,
): Promise<RuleConfig[]> {
  assertAdminAccess(options);

  const response = await fetch(`${normaliseGatewayUrl(options.gatewayUrl)}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(options.adminToken),
      ...(init?.headers ?? {}),
    },
  });

  const rawBody = await readResponseBody(response);
  const parsed = rawBody ? (JSON.parse(rawBody) as RulesResponse) : {};

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
