import { jest } from '@jest/globals';

import { sendWebhookAlert } from './webhook';

import type { AlertPayload } from '@rateforge/types';

const BASE_ALERT: AlertPayload = {
  id: 'alert-1',
  createdAt: Date.now(),
  severity: 'warning',
  message: 'Blocked traffic ratio exceeded the alert threshold.',
  metadata: {
    blockedRatio: 0.3,
  },
};

describe('sendWebhookAlert', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not call fetch when no webhook URL is configured', async () => {
    const fetchImpl = jest.fn<typeof fetch>();

    await sendWebhookAlert(BASE_ALERT, {
      fetchImpl,
      webhookUrl: undefined,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the alert payload with a Slack-compatible text field when configured', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    } as Response);

    await sendWebhookAlert(BASE_ALERT, {
      fetchImpl,
      webhookUrl: 'https://example.com/webhook',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
      }),
    );

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      text: string;
    };
    expect(body.text).toBe(BASE_ALERT.message);
  });

  it('swallows webhook delivery failures so alerting never crashes the service', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      sendWebhookAlert(BASE_ALERT, {
        fetchImpl,
        webhookUrl: 'https://example.com/webhook',
      }),
    ).resolves.toBeUndefined();
  });
});
