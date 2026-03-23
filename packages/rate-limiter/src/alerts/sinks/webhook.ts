import { ALERT_WEBHOOK_URL } from '@rateforge/config';

import { getErrorMeta, logger } from '../../utils/logger';

import type { AlertPayload } from '@rateforge/types';

interface WebhookEnvelope extends AlertPayload {
  text: string;
}

export interface SendWebhookAlertOptions {
  fetchImpl?: typeof fetch;
  webhookUrl?: string;
}

export async function sendWebhookAlert(
  payload: AlertPayload,
  options: SendWebhookAlertOptions = {},
): Promise<void> {
  const webhookUrl = options.webhookUrl ?? ALERT_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.warn({
      message: 'Alert webhook URL not configured; alert retained in logs only',
      event: 'alert.webhook.skipped',
      alertId: payload.id,
      severity: payload.severity,
      alertPayload: payload,
    });
    return;
  }

  const body: WebhookEnvelope = {
    ...payload,
    text: payload.message,
  };

  try {
    const response = await (options.fetchImpl ?? fetch)(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Webhook request failed (${response.status} ${response.statusText})${errorBody ? `: ${errorBody}` : ''}`,
      );
    }

    logger.info({
      message: 'Alert webhook delivered successfully',
      event: 'alert.webhook.delivered',
      alertId: payload.id,
      severity: payload.severity,
      webhookUrl,
    });
  } catch (error) {
    logger.error({
      message: 'Alert webhook delivery failed',
      event: 'alert.webhook.failed',
      alertId: payload.id,
      webhookUrl,
      ...getErrorMeta(error),
    });
  }
}
