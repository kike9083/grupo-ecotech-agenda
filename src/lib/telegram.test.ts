import { describe, expect, it, vi } from 'vitest';
import {
  TelegramCallError,
  createFetchTransport,
  createTelegramApi,
  type Transport,
  type TransportCallOptions,
} from './telegram';

const TOKEN = '7123456789:AAFakeTokenValue_do_not_leak';
const CHAT_ID = '987654321';

interface TransportCall {
  method: string;
  body: Record<string, unknown>;
  options: TransportCallOptions | undefined;
}

/** Fake transport: no network, no credentials (design D3 testing strategy). */
class FakeTransport implements Transport {
  calls: TransportCall[] = [];
  next: { status: number; payload: unknown } = { status: 200, payload: { ok: true, result: [] } };
  nextError: unknown = undefined;

  async call(
    method: string,
    body: Record<string, unknown>,
    options?: TransportCallOptions,
  ): Promise<{ status: number; payload: unknown }> {
    this.calls.push({ method, body, options });
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
    return this.next;
  }
}

function apiWith(transport: Transport) {
  return createTelegramApi({ token: TOKEN, transport });
}

describe('getUpdates (design D3 — long poll)', () => {
  it('sends the offset, a 50 second timeout and the abort signal', async () => {
    const transport = new FakeTransport();
    const api = apiWith(transport);
    const controller = new AbortController();

    await api.getUpdates({ offset: 42, signal: controller.signal });

    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0];
    expect(call.method).toBe('getUpdates');
    expect(call.body).toMatchObject({ offset: 42, timeout: 50 });
    expect(call.options?.signal).toBe(controller.signal);
    // The long-poll transport deadline must outlive the 50 s server wait.
    expect(call.options?.timeoutMs ?? 0).toBeGreaterThan(50_000);
  });

  it('defaults to offset 0 and returns the update list on ok responses', async () => {
    const transport = new FakeTransport();
    transport.next = {
      status: 200,
      payload: {
        ok: true,
        result: [
          { update_id: 7, message: { text: '/start tok', chat: { id: 123 } } },
        ],
      },
    };
    const api = apiWith(transport);

    const updates = await api.getUpdates();

    expect(transport.calls[0].body).toMatchObject({ offset: 0, timeout: 50 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ update_id: 7 });
    expect(updates[0].message?.text).toBe('/start tok');
  });

  it('throws a redacted TelegramCallError on a 500', async () => {
    const transport = new FakeTransport();
    transport.next = { status: 500, payload: { ok: false } };
    const api = apiWith(transport);

    const failure = await api.getUpdates().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TelegramCallError);
    expect(failure).toMatchObject({ method: 'getUpdates', status: 500 });
  });

  it('wraps a network failure as a redacted TelegramCallError with status 0', async () => {
    const transport = new FakeTransport();
    transport.nextError = new Error('fetch failed');
    const api = apiWith(transport);

    const failure = await api.getUpdates({ offset: 9 }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TelegramCallError);
    expect(failure).toMatchObject({ method: 'getUpdates', status: 0 });
  });
});

describe('sendMessage outcome mapping (specs reminder-delivery → Send failure and retry, notification-channels → Channel contract)', () => {
  it('reports delivered when the provider accepts the message', async () => {
    const transport = new FakeTransport();
    transport.next = { status: 200, payload: { ok: true, result: {} } };
    const api = apiWith(transport);

    expect(await api.sendMessage(CHAT_ID, 'Recordatorio: pagar el agua')).toEqual({
      status: 'delivered',
    });
    expect(transport.calls[0]).toMatchObject({
      method: 'sendMessage',
      body: { chat_id: CHAT_ID, text: 'Recordatorio: pagar el agua' },
    });
  });

  it('reports blocked when the recipient blocked the bot (403)', async () => {
    const transport = new FakeTransport();
    transport.next = { status: 403, payload: { ok: false } };
    const api = apiWith(transport);

    expect(await api.sendMessage(CHAT_ID, 'hola')).toEqual({ status: 'blocked' });
  });

  it('reports transient with the server retry delay on 429', async () => {
    const transport = new FakeTransport();
    transport.next = {
      status: 429,
      payload: { ok: false, parameters: { retry_after: 30 } },
    };
    const api = apiWith(transport);

    expect(await api.sendMessage(CHAT_ID, 'hola')).toEqual({
      status: 'transient',
      retryAfterMs: 30_000,
    });
  });

  it('reports transient on 5xx and on a network failure', async () => {
    const serverFailure = new FakeTransport();
    serverFailure.next = { status: 503, payload: { ok: false } };
    expect(await apiWith(serverFailure).sendMessage(CHAT_ID, 'hola')).toEqual({
      status: 'transient',
    });

    const networkFailure = new FakeTransport();
    networkFailure.nextError = new TypeError('fetch failed');
    expect(await apiWith(networkFailure).sendMessage(CHAT_ID, 'hola')).toEqual({
      status: 'transient',
    });
  });

  it('reports transient when a 429 carries no retry_after', async () => {
    const transport = new FakeTransport();
    transport.next = { status: 429, payload: { ok: false } };
    const api = apiWith(transport);

    expect(await api.sendMessage(CHAT_ID, 'hola')).toEqual({ status: 'transient' });
  });
});

describe('logging contract (spec telegram-linking → Bot callback validation: no logging)', () => {
  it('never carries the bot token, chat id or URL in the error', async () => {
    const transport = new FakeTransport();
    transport.next = { status: 500, payload: { ok: false } };
    const api = apiWith(transport);

    const error = await api.getUpdates().then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TelegramCallError);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    const thrown = error as Error;
    expect(`${thrown.message}${serialized}`).not.toContain(TOKEN);
    expect(`${thrown.message}${serialized}`).not.toContain(CHAT_ID);
    expect(`${thrown.message}${serialized}`).not.toContain('api.telegram.org');
    expect(thrown.message).toContain('getUpdates');
    expect(thrown.message).toContain('500');
  });

  it('keeps the same redaction when a send blows up unexpectedly', async () => {
    const transport = new FakeTransport();
    transport.nextError = new Error(`cannot POST https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const api = apiWith(transport);

    const outcome = await api.sendMessage(CHAT_ID, 'hola');

    expect(outcome.status).toBe('transient');
  });
});

describe('default transport (design D3 — fetch + AbortSignal.timeout)', () => {
  it('POSTs the body to the bot URL and parses the JSON payload', async () => {
    const fetchMock = vi.fn(
      async (): Promise<{ status: number; text: () => Promise<string> }> => ({
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: [] }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const transport = createFetchTransport(TOKEN);
      const result = await transport.call(
        'getUpdates',
        { offset: 0, timeout: 50 },
        { timeoutMs: 65_000 },
      );

      expect(result).toEqual({ status: 200, payload: { ok: true, result: [] } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { method: string; body: string; signal: AbortSignal },
      ];
      expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ offset: 0, timeout: 50 });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('turns a rejected fetch into status 0 instead of propagating the URL', async () => {
    vi.stubGlobal(
      'fetch',
      async (): Promise<never> => {
        throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}`);
      },
    );

    try {
      const result = await createFetchTransport(TOKEN).call('sendMessage', {
        chat_id: CHAT_ID,
        text: 'hola',
      });

      expect(result).toEqual({ status: 0, payload: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a non-JSON body as a null payload with its real status', async () => {
    vi.stubGlobal(
      'fetch',
      async (): Promise<{ status: number; text: () => Promise<string> }> => ({
        status: 502,
        text: async () => '<html>bad gateway</html>',
      }),
    );

    try {
      const result = await createFetchTransport(TOKEN).call('getUpdates', {});

      expect(result).toEqual({ status: 502, payload: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
