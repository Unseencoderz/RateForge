import { createHmac, timingSafeEqual } from 'crypto';

const SERVICE_HEADER = 'x-rateforge-service';
const TIMESTAMP_HEADER = 'x-rateforge-timestamp';
const SIGNATURE_HEADER = 'x-rateforge-signature';
const DEFAULT_MAX_SKEW_MS = 30_000;

function buildPayload(service: string, method: string, path: string, timestamp: string): string {
  return [service, method.toUpperCase(), path, timestamp].join('\n');
}

export function createInternalServiceHeaders(input: {
  service: string;
  method: string;
  path: string;
  secret: string;
  timestamp?: number;
}): Record<string, string> {
  const timestamp = String(input.timestamp ?? Date.now());
  const signature = createHmac('sha256', input.secret)
    .update(buildPayload(input.service, input.method, input.path, timestamp))
    .digest('hex');

  return {
    [SERVICE_HEADER]: input.service,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signature,
  };
}

export function verifyInternalServiceHeaders(input: {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  secret: string;
  maxSkewMs?: number;
}): { ok: true; service: string } | { ok: false; error: string } {
  const serviceHeader = input.headers[SERVICE_HEADER];
  const timestampHeader = input.headers[TIMESTAMP_HEADER];
  const signatureHeader = input.headers[SIGNATURE_HEADER];

  const service = Array.isArray(serviceHeader) ? serviceHeader[0] : serviceHeader;
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!service || !timestamp || !signature) {
    return { ok: false, error: 'Missing internal authentication headers.' };
  }

  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return { ok: false, error: 'Invalid internal authentication timestamp.' };
  }

  const maxSkewMs = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(Date.now() - parsedTimestamp) > maxSkewMs) {
    return { ok: false, error: 'Internal authentication timestamp has expired.' };
  }

  const expected = createHmac('sha256', input.secret)
    .update(buildPayload(service, input.method, input.path, timestamp))
    .digest('hex');

  const providedBuffer = Uint8Array.from(Buffer.from(signature, 'hex'));
  const expectedBuffer = Uint8Array.from(Buffer.from(expected, 'hex'));

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, error: 'Invalid internal authentication signature.' };
  }

  return { ok: true, service };
}
