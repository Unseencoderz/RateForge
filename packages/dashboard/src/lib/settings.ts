export interface DashboardSettings {
  adminToken: string;
  gatewayUrl: string;
}

export const GATEWAY_URL_STORAGE_KEY = 'rateforge.dashboard.gatewayUrl';
export const ADMIN_TOKEN_STORAGE_KEY = 'rateforge.dashboard.adminToken';

export function normaliseGatewayUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function readInitialDashboardSettings(): DashboardSettings {
  const storedGatewayUrl = window.localStorage.getItem(GATEWAY_URL_STORAGE_KEY)?.trim();
  const metaGatewayUrl = document
    .querySelector<HTMLMetaElement>('meta[name="rateforge-gateway-url"]')
    ?.content.trim();

  const gatewayUrl = storedGatewayUrl
    ? normaliseGatewayUrl(storedGatewayUrl)
    : metaGatewayUrl
      ? normaliseGatewayUrl(metaGatewayUrl)
      : 'http://localhost:3000';

  return {
    gatewayUrl,
    adminToken: window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() ?? '',
  };
}

export function persistGatewayUrl(gatewayUrl: string): void {
  window.localStorage.setItem(GATEWAY_URL_STORAGE_KEY, normaliseGatewayUrl(gatewayUrl));
}

export function persistAdminToken(adminToken: string): void {
  window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken.trim());
}

export function describeGatewayTarget(gatewayUrl: string): string {
  if (!gatewayUrl) {
    return 'No gateway target saved';
  }

  try {
    const url = new URL(gatewayUrl);
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return gatewayUrl;
  }
}
