import { describe, expect, it, vi } from 'vitest';
import { createTelegramChannel } from './telegram-channel';
import {
  createTelegramApi,
  type Transport,
  type TransportResult,
} from './telegram';

/**
 * PR6 task 6.1 (design D6) — the Telegram implementation of the channel
 * contract. The scheduler only ever sees `ChannelOutcome`; the HTTP mapping
 * (200/403/429/5xx/network) stays behind the seam, so a later WhatsApp channel
 * drops in without touching scheduling (`Additional channels are additive`).
 *
 * Spec: `notification-channels` → Channel contract (Delivered outcome,
 * Blocked outcome). Driven through a fake transport ⇒ no network, no
 * credentials (design D3 injectable transport).
 */

function transport(result: TransportResult | Error): Transport {
  return {
    call: vi.fn(async () => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }),
  };
}

function channelWith(result: TransportResult | Error) {
  const fake = transport(result);
  const api = createTelegramApi({ token: 'fake-token', transport: fake });
  return { channel: createTelegramChannel(api), calls: fake.call };
}

describe('telegram channel (spec notification-channels → Channel contract)', () => {
  it('reports delivered when the provider accepts the message', async () => {
    const { channel, calls } = channelWith({
      status: 200,
      payload: { ok: true, result: { message_id: 7 } },
    });

    await expect(channel.send('555000111', 'Recordatorio: agua')).resolves.toEqual(
      { status: 'delivered' },
    );
    expect(calls).toHaveBeenCalledWith(
      'sendMessage',
      { chat_id: '555000111', text: 'Recordatorio: agua' },
      expect.objectContaining({ timeoutMs: 15_000 }),
    );
  });

  it('reports blocked — never delivered — when the recipient rejected the bot', async () => {
    const { channel } = channelWith({ status: 403, payload: null });

    await expect(channel.send('555000111', 'Recordatorio')).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('reports transient with the server delay on 429', async () => {
    const { channel } = channelWith({
      status: 429,
      payload: { ok: false, parameters: { retry_after: 30 } },
    });

    await expect(channel.send('555000111', 'Recordatorio')).resolves.toEqual({
      status: 'transient',
      retryAfterMs: 30_000,
    });
  });

  it('reports transient on a 5xx server error', async () => {
    const { channel } = channelWith({ status: 500, payload: null });

    await expect(channel.send('555000111', 'Recordatorio')).resolves.toEqual({
      status: 'transient',
    });
  });

  it('reports transient when the transport fails at network level', async () => {
    const { channel } = channelWith(new Error('socket hang up'));

    await expect(channel.send('555000111', 'Recordatorio')).resolves.toEqual({
      status: 'transient',
    });
  });

  it('identifies itself as the telegram channel (design D6 `id`)', () => {
    const { channel } = channelWith({ status: 200, payload: { ok: true } });
    expect(channel.id).toBe('telegram');
  });
});
