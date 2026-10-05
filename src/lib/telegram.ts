/**
 * Telegram Bot API client (design D3).
 *
 * Everything is injectable: `createTelegramApi({ token, transport })` takes a
 * `Transport` so tests run with a fake — no network, no credentials. The
 * default transport builds `https://api.telegram.org/bot<token>/<method>` with
 * `fetch` + `AbortSignal.timeout`.
 *
 * Logging contract: the ONLY error type this module throws is
 * `TelegramCallError { method, status }`. The URL carries the bot token, so it
 * is never part of any message; chat ids and `/start` payloads are never
 * logged either (spec `telegram-linking` → "Bot callback validation").
 */

/** Options a caller can attach to a transport call (abort + deadline). */
export interface TransportCallOptions {
  /** Deadline for the HTTP round trip; long polls pass `> timeoutSeconds * 1000`. */
  timeoutMs?: number;
  /** Caller-owned abort (SIGTERM teardown of an in-flight `getUpdates`). */
  signal?: AbortSignal;
}

/** Result of one Telegram call. `status: 0` means "no HTTP response". */
export interface TransportResult {
  status: number;
  payload: unknown;
}

/** Minimal HTTP seam so tests inject a fake (design D3). */
export interface Transport {
  call(
    method: string,
    body: Record<string, unknown>,
    options?: TransportCallOptions,
  ): Promise<TransportResult>;
}

/**
 * The only error the client raises: method + HTTP status, nothing else.
 * `status: 0` = network failure with no response (design D3).
 */
export class TelegramCallError extends Error {
  readonly method: string;
  readonly status: number;

  constructor(method: string, status: number) {
    super(`Telegram call failed: ${method} (HTTP ${status})`);
    this.name = 'TelegramCallError';
    this.method = method;
    this.status = status;
  }
}

/** Update shape the bot loop cares about (`/start <token>`). */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number };
    from?: { id: number };
  };
}

/**
 * Send outcome (design D3): mirrors `notification-channels`' `ChannelOutcome`
 * so the scheduler can consume it unchanged in PR6.
 */
export type TelegramSendOutcome =
  | { status: 'delivered' }
  | { status: 'blocked' }
  | { status: 'transient'; retryAfterMs?: number };

/** Long-poll duration the bot loop uses (design D3 / D1). */
export const GET_UPDATES_TIMEOUT_SECONDS = 50;

function isOk(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { ok?: unknown }).ok === true
  );
}

function readUpdates(payload: unknown): TelegramUpdate[] {
  const result = (payload as { result?: unknown } | null)?.result;
  return Array.isArray(result) ? (result as TelegramUpdate[]) : [];
}

function readRetryAfterMs(payload: unknown): number | undefined {
  const parameters = (payload as { parameters?: { retry_after?: unknown } } | null)
    ?.parameters;
  const retryAfter = parameters?.retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter)
    ? retryAfter * 1000
    : undefined;
}

/** Default transport: raw `fetch` with a deadline and the caller's signal. */
export function createFetchTransport(token: string): Transport {
  return {
    async call(method, body, options = {}) {
      const url = `https://api.telegram.org/bot${token}/${method}`;
      const timeoutMs = options.timeoutMs ?? 30_000;
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (options.signal !== undefined) {
        signals.push(options.signal);
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });

        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = text === '' ? null : JSON.parse(text);
        } catch {
          payload = null;
        }
        return { status: response.status, payload };
      } catch {
        // Network/abort failure: no HTTP response. Never rethrow — a raw
        // fetch error could carry the URL (and with it the bot token).
        return { status: 0, payload: null };
      }
    },
  };
}

export interface CreateTelegramApiOptions {
  token: string;
  /** Injected in tests; defaults to `createFetchTransport(token)`. */
  transport?: Transport;
}

export function createTelegramApi(options: CreateTelegramApiOptions) {
  const transport = options.transport ?? createFetchTransport(options.token);

  /**
   * Normalizes transport behaviour: a thrown transport error is a
   * network-level failure (`status: 0`), and the raw error — which may embed
   * the request URL — is discarded so it can never reach a log.
   */
  async function call(
    method: string,
    body: Record<string, unknown>,
    callOptions?: TransportCallOptions,
  ): Promise<TransportResult> {
    try {
      return await transport.call(method, body, callOptions);
    } catch {
      return { status: 0, payload: null };
    }
  }

  return {
    /**
     * Long poll for pending updates. Throws `TelegramCallError` on any
     * non-ok outcome (the bot loop catches it and backs off — design D1);
     * never returns a partially parsed payload.
     */
    async getUpdates(params: {
      offset?: number;
      timeoutSeconds?: number;
      signal?: AbortSignal;
    } = {}): Promise<TelegramUpdate[]> {
      const timeoutSeconds = params.timeoutSeconds ?? GET_UPDATES_TIMEOUT_SECONDS;
      const { status, payload } = await call(
        'getUpdates',
        { offset: params.offset ?? 0, timeout: timeoutSeconds },
        {
          // The transport deadline must outlive the server-side long poll.
          timeoutMs: (timeoutSeconds + 15) * 1000,
          signal: params.signal,
        },
      );

      if (status !== 200 || !isOk(payload)) {
        throw new TelegramCallError('getUpdates', status);
      }
      return readUpdates(payload);
    },

    /**
     * Delivers one message and ALWAYS answers with an outcome instead of
     * throwing (spec `reminder-delivery` → "Send failure and retry"):
     * 200 → `delivered`, 403 → `blocked`, 429 → `transient` with the server
     * delay, everything else (5xx, other 4xx, network) → `transient`.
     */
    async sendMessage(
      chatId: string,
      text: string,
      signal?: AbortSignal,
    ): Promise<TelegramSendOutcome> {
      const { status, payload } = await call(
        'sendMessage',
        { chat_id: chatId, text },
        { timeoutMs: 15_000, signal },
      );

      if (status === 200 && isOk(payload)) {
        return { status: 'delivered' };
      }
      if (status === 403) {
        return { status: 'blocked' };
      }
      if (status === 429) {
        const retryAfterMs = readRetryAfterMs(payload);
        return retryAfterMs === undefined
          ? { status: 'transient' }
          : { status: 'transient', retryAfterMs };
      }
      return { status: 'transient' };
    },
  };
}

export type TelegramApi = ReturnType<typeof createTelegramApi>;
