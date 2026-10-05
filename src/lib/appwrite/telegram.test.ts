import { describe, expect, it } from 'vitest';
import { isDomainError } from './errors';
import {
  createTelegramSubscriptionsApi,
  type TelegramDatabasesLike,
  type TelegramRawDocument,
} from './telegram';

const config = {
  databaseId: 'agenda',
  collectionId: 'telegram_subscriptions',
};

interface CreateCall {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
  permissions: string[] | undefined;
}

interface ListCall {
  databaseId: string;
  collectionId: string;
  queries: string[];
}

interface UpdateCall {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown> | undefined;
}

/** Records every wire payload — assertions never mock the SDK (design D5). */
class FakeDatabases implements TelegramDatabasesLike {
  createCalls: CreateCall[] = [];
  listCalls: ListCall[] = [];
  updateCalls: UpdateCall[] = [];
  nextError: unknown = undefined;
  nextList: { total: number; documents: TelegramRawDocument[] } = {
    total: 0,
    documents: [],
  };
  /** Per-call responses, consumed in order (pagination tests). */
  listQueue: Array<{ total: number; documents: TelegramRawDocument[] }> = [];

  private takeError(): void {
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
  }

  async createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ): Promise<TelegramRawDocument> {
    this.createCalls.push({ databaseId, collectionId, documentId, data, permissions });
    this.takeError();
    return { $id: documentId, ...data };
  }

  async listDocuments(
    databaseId: string,
    collectionId: string,
    queries: string[] = [],
  ): Promise<{ total: number; documents: TelegramRawDocument[] }> {
    this.listCalls.push({ databaseId, collectionId, queries });
    this.takeError();
    if (this.listQueue.length > 0) {
      return this.listQueue.shift() as {
        total: number;
        documents: TelegramRawDocument[];
      };
    }
    return this.nextList;
  }

  async updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
  ): Promise<TelegramRawDocument> {
    this.updateCalls.push({ databaseId, collectionId, documentId, data });
    this.takeError();
    return { $id: documentId, ...(data ?? {}) };
  }
}

function subscriptionDoc(
  id: string,
  overrides: Record<string, unknown> = {},
): TelegramRawDocument {
  return {
    $id: id,
    userId: 'user-123',
    chatId: '',
    active: false,
    token: '',
    tokenExpiresAt: '',
    ...overrides,
  };
}

function parsedQueries(call: ListCall | undefined): Array<Record<string, unknown>> {
  return (call?.queries ?? []).map((query) => JSON.parse(query));
}

describe('upsertSubscription (spec telegram-linking → Link initiation)', () => {
  it('creates the caller document with owner-only grants and the unlinked defaults', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    const created = await api.upsertSubscription('user-123');

    expect(fake.createCalls).toHaveLength(1);
    const call = fake.createCalls[0];
    expect(call.databaseId).toBe('agenda');
    expect(call.collectionId).toBe('telegram_subscriptions');
    expect(call.data).toEqual({
      userId: 'user-123',
      chatId: '',
      active: false,
      token: '',
      tokenExpiresAt: '',
    });
    // Design D7: doc grants go to the owner; admins read through the
    // collection-level `team:admins` grant (a member session cannot grant a
    // role it does not hold — verify F3b).
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
    ]);
    expect(created).toMatchObject({
      $id: expect.any(String),
      userId: 'user-123',
      active: false,
      chatId: '',
    });
  });

  it('returns the existing document untouched instead of creating a second one', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [subscriptionDoc('sub-1')] };
    const api = createTelegramSubscriptionsApi(fake, config);

    const existing = await api.upsertSubscription('user-123');

    expect(fake.createCalls).toHaveLength(0);
    expect(existing.$id).toBe('sub-1');
  });
});

describe('getByUser (spec telegram-linking → Link status and unlink)', () => {
  it('reads exactly one document for the user id', async () => {
    const fake = new FakeDatabases();
    fake.nextList = { total: 1, documents: [subscriptionDoc('sub-9', { active: true, chatId: '555000' })] };
    const api = createTelegramSubscriptionsApi(fake, config);

    const found = await api.getByUser('user-123');

    const queries = parsedQueries(fake.listCalls[0]);
    expect(queries).toEqual([
      { method: 'equal', attribute: 'userId', values: ['user-123'] },
      { method: 'limit', values: [1] },
    ]);
    expect(found).toMatchObject({ $id: 'sub-9', active: true, chatId: '555000' });
  });

  it('returns null when the user never linked', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    expect(await api.getByUser('user-123')).toBeNull();
  });
});

describe('findByToken (spec telegram-linking → Bot callback validation)', () => {
  it('looks the token up through the key index with limit 1', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 1,
      documents: [subscriptionDoc('sub-7', { token: 'tok-abc', tokenExpiresAt: '2026-10-05T12:00:00.000Z' })],
    };
    const api = createTelegramSubscriptionsApi(fake, config);

    const found = await api.findByToken('tok-abc');

    expect(parsedQueries(fake.listCalls[0])).toEqual([
      { method: 'equal', attribute: 'token', values: ['tok-abc'] },
      { method: 'limit', values: [1] },
    ]);
    expect(found?.$id).toBe('sub-7');
  });

  it('never queries the empty token, which every unlinked document carries', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    expect(await api.findByToken('')).toBeNull();
    expect(fake.listCalls).toHaveLength(0);
  });
});

describe('listActiveSubs (spec telegram-linking → Deactivated subscription on block)', () => {
  it('lists only active subscriptions as userId → chatId pairs', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        subscriptionDoc('sub-a', { userId: 'user-a', chatId: '111', active: true }),
        subscriptionDoc('sub-b', { userId: 'user-b', chatId: '222', active: true }),
      ],
    };
    const api = createTelegramSubscriptionsApi(fake, config);

    const subs = await api.listActiveSubs();

    expect(parsedQueries(fake.listCalls[0])).toEqual([
      { method: 'equal', attribute: 'active', values: [true] },
      { method: 'limit', values: [100] },
    ]);
    expect(subs).toEqual([
      { userId: 'user-a', chatId: '111' },
      { userId: 'user-b', chatId: '222' },
    ]);
  });

  it('keeps reading with the cursor until a short page, so no link is dropped', async () => {
    const fake = new FakeDatabases();
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      subscriptionDoc(`sub-${index}`, {
        userId: `user-${index}`,
        chatId: `chat-${index}`,
        active: true,
      }),
    );
    fake.listQueue = [
      { total: 101, documents: fullPage },
      {
        total: 101,
        documents: [
          subscriptionDoc('sub-100', {
            userId: 'user-100',
            chatId: 'chat-100',
            active: true,
          }),
        ],
      },
    ];
    const api = createTelegramSubscriptionsApi(fake, config);

    const subs = await api.listActiveSubs();

    expect(fake.listCalls).toHaveLength(2);
    expect(parsedQueries(fake.listCalls[1])).toEqual(
      expect.arrayContaining([
        { method: 'cursorAfter', values: ['sub-99'] },
      ]),
    );
    expect(subs).toHaveLength(101);
    expect(subs[100]).toEqual({ userId: 'user-100', chatId: 'chat-100' });
  });

  it('drops an active row whose chatId is empty (never-linked data)', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        subscriptionDoc('sub-a', { userId: 'user-a', chatId: '', active: true }),
        subscriptionDoc('sub-b', { userId: 'user-b', chatId: '222', active: true }),
      ],
    };
    const api = createTelegramSubscriptionsApi(fake, config);

    expect(await api.listActiveSubs()).toEqual([{ userId: 'user-b', chatId: '222' }]);
  });
});

describe('link (spec telegram-linking → Bot callback validation: Successful exchange)', () => {
  it('stores the chat id, activates the subscription and consumes the token', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    const linked = await api.link('sub-7', '999888');

    expect(fake.updateCalls).toHaveLength(1);
    expect(fake.updateCalls[0]).toMatchObject({
      databaseId: 'agenda',
      collectionId: 'telegram_subscriptions',
      documentId: 'sub-7',
      data: {
        chatId: '999888',
        active: true,
        token: '',
        tokenExpiresAt: '',
      },
    });
    expect(linked.chatId).toBe('999888');
    expect(linked.active).toBe(true);
    expect(linked.token).toBe('');
  });
});

describe('deactivate (spec telegram-linking → Deactivated subscription on block)', () => {
  it('flips active to false and leaves the stored chat id alone', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    const deactivated = await api.deactivate('sub-7');

    expect(fake.updateCalls[0]).toMatchObject({
      documentId: 'sub-7',
      data: { active: false },
    });
    expect(deactivated.active).toBe(false);
  });
});

describe('unlink (spec telegram-linking → Link status and unlink: Unlink)', () => {
  it('resets the binding, the pending token and the active flag', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    await api.unlink('sub-7');

    expect(fake.updateCalls[0]).toMatchObject({
      documentId: 'sub-7',
      data: {
        chatId: '',
        active: false,
        token: '',
        tokenExpiresAt: '',
      },
    });
  });

  it('leaves the userId untouched so the one-doc-per-user identity survives', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    await api.unlink('sub-7');

    expect('userId' in (fake.updateCalls[0].data ?? {})).toBe(false);
  });
});

describe('error mapping', () => {
  it('maps a rejected read to a typed domain error', async () => {
    const fake = new FakeDatabases();
    fake.nextError = { code: 401, type: 'user_session_expired', message: 'Session expired' };
    const api = createTelegramSubscriptionsApi(fake, config);

    const failure = await api.getByUser('user-123').then(
      () => null,
      (error: unknown) => error,
    );

    expect(isDomainError(failure)).toBe(true);
    if (isDomainError(failure)) {
      expect(failure.kind).toBe('session-expired');
    }
  });
});

describe('saveToken (phase 7 wiring — design D4 concrete mint seam)', () => {
  it('writes token and tokenExpiresAt onto the caller document', async () => {
    const fake = new FakeDatabases();
    const api = createTelegramSubscriptionsApi(fake, config);

    await api.saveToken('sub-1', 'tok_abc', '2026-03-04T10:10:00.000Z');

    expect(fake.updateCalls).toEqual([
      {
        databaseId: 'agenda',
        collectionId: 'telegram_subscriptions',
        documentId: 'sub-1',
        data: { token: 'tok_abc', tokenExpiresAt: '2026-03-04T10:10:00.000Z' },
      },
    ]);
  });
});
