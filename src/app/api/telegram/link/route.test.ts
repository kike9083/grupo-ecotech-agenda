import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeLinkResult } from '@/lib/telegram-link';
import { handleLink, type LinkRouteDeps } from './route';

/**
 * RED seam for PR4 task 4.3 (spec `telegram-linking` → "Bot callback
 * validation"): the shared-secret header is the gate — missing, wrong or
 * wrong-length secrets answer 401 WITHOUT touching storage, a rejected token
 * answers the uniform 404, and a valid exchange answers 200. Same injected-deps
 * shape as `api/attachments/[fileId]/route.test.ts`: the domain is a fake, so
 * no module mocking and no Appwrite client is ever constructed.
 *
 * Requirement text also forbids logging tokens and chat ids — asserted below.
 */

const SECRET = 'a-shared-secret-of-decent-length';
const TOKEN = 'qzW9xK2mN4pL7rT1vY6bD8fH0jS3gA5cE';
const CHAT_ID = '555000111';

function callbackRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://127.0.0.1:3000/api/telegram/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function rawRequest(text: string, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:3000/api/telegram/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: text,
  });
}

interface Harness {
  deps: LinkRouteDeps;
  exchanges: Array<{ token: string; chatId: string }>;
}

function makeHarness(
  options: {
    linkSecret?: string | null;
    result?: ExchangeLinkResult;
  } = {},
): Harness {
  const exchanges: Array<{ token: string; chatId: string }> = [];
  const deps: LinkRouteDeps = {
    linkSecret: options.linkSecret === undefined ? SECRET : options.linkSecret,
    exchange: async (params) => {
      exchanges.push(params);
      return options.result ?? { status: 'linked' };
    },
  };
  return { deps, exchanges };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleLink (spec telegram-linking → Bot callback validation → Missing secret header rejected)', () => {
  it('answers 401 without a shared-secret header and never touches storage', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      callbackRequest({ token: TOKEN, chatId: CHAT_ID }),
    );

    expect(response.status).toBe(401);
    expect(harness.exchanges).toEqual([]);
  });

  it('answers 401 for a wrong secret and never touches storage', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': `${SECRET}x` },
      ),
    );

    expect(response.status).toBe(401);
    expect(harness.exchanges).toEqual([]);
  });

  it('answers 401 for a wrong-length secret without throwing', async () => {
    const short = makeHarness();
    const long = makeHarness();

    const shortResponse = await handleLink(
      short.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': 'abc' },
      ),
    );
    const longResponse = await handleLink(
      long.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': `${SECRET}${SECRET}` },
      ),
    );

    expect(shortResponse.status).toBe(401);
    expect(longResponse.status).toBe(401);
    expect(short.exchanges).toEqual([]);
    expect(long.exchanges).toEqual([]);
  });

  it('answers 401 when the feature is unconfigured (linkSecret null)', async () => {
    const harness = makeHarness({ linkSecret: null });

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );

    expect(response.status).toBe(401);
    expect(harness.exchanges).toEqual([]);
  });

  it('never echoes the secret or the token in the 401 body', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': 'guess' },
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('guess');
    expect(text).not.toContain(TOKEN);
  });
});

describe('handleLink (spec telegram-linking → Bot callback validation → Successful exchange)', () => {
  it('answers 200 and forwards the token and chat id to the domain', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'linked' });
    expect(harness.exchanges).toEqual([{ token: TOKEN, chatId: CHAT_ID }]);
  });

  it('coerces a numeric chat id from the bot payload', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: 555000111 },
        { 'x-link-secret': SECRET },
      ),
    );

    expect(response.status).toBe(200);
    expect(harness.exchanges).toEqual([{ token: TOKEN, chatId: '555000111' }]);
  });

  it('answers 200 for an idempotent already-linked result', async () => {
    const harness = makeHarness({ result: { status: 'already-linked' } });

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'already-linked' });
  });
});

describe('handleLink (spec telegram-linking → Bot callback validation → Reused token rejected)', () => {
  it('maps a rejected exchange to the uniform 404', async () => {
    const harness = makeHarness({ result: { status: 'rejected' } });

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('maps an empty token to the very same 404 (no oracle)', async () => {
    const harness = makeHarness({ result: { status: 'rejected' } });

    const response = await handleLink(
      harness.deps,
      callbackRequest({ token: '', chatId: CHAT_ID }, { 'x-link-secret': SECRET }),
    );

    expect(response.status).toBe(404);
    expect(harness.exchanges).toEqual([{ token: '', chatId: CHAT_ID }]);
  });

  it('answers 404 without echoing which token failed', async () => {
    const harness = makeHarness({ result: { status: 'rejected' } });

    const response = await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(CHAT_ID);
  });
});

describe('handleLink (malformed callback payload)', () => {
  it('answers 400 for a body that is not JSON, without touching storage', async () => {
    const harness = makeHarness();

    const response = await handleLink(
      harness.deps,
      rawRequest('this is not json', { 'x-link-secret': SECRET }),
    );

    expect(response.status).toBe(400);
    expect(harness.exchanges).toEqual([]);
  });

  it('answers 400 when the token is missing or not a string', async () => {
    const harness = makeHarness();

    const missing = await handleLink(
      harness.deps,
      callbackRequest({ chatId: CHAT_ID }, { 'x-link-secret': SECRET }),
    );
    const wrongType = await handleLink(
      harness.deps,
      callbackRequest({ token: 42, chatId: CHAT_ID }, { 'x-link-secret': SECRET }),
    );

    expect(missing.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(harness.exchanges).toEqual([]);
  });

  it('answers 400 when the chat id is missing or unusable', async () => {
    const harness = makeHarness();

    const missing = await handleLink(
      harness.deps,
      callbackRequest({ token: TOKEN }, { 'x-link-secret': SECRET }),
    );
    const empty = await handleLink(
      harness.deps,
      callbackRequest({ token: TOKEN, chatId: '' }, { 'x-link-secret': SECRET }),
    );

    expect(missing.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(harness.exchanges).toEqual([]);
  });
});

describe('handleLink (spec telegram-linking → Bot callback validation: nothing sensitive is logged)', () => {
  it('never writes the token, the chat id or the secret to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const harness = makeHarness({ result: { status: 'linked' } });

    await handleLink(
      harness.deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );
    await handleLink(harness.deps, callbackRequest({ token: TOKEN, chatId: CHAT_ID }));
    await handleLink(
      makeHarness({ result: { status: 'rejected' } }).deps,
      callbackRequest(
        { token: TOKEN, chatId: CHAT_ID },
        { 'x-link-secret': SECRET },
      ),
    );

    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join('\n');

    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(CHAT_ID);
    expect(logged).not.toContain(SECRET);
  });
});
