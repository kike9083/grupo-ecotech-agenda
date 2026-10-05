import { describe, expect, it } from 'vitest';
import type { ActiveSubscription } from './telegram';
import type { RawDocument } from './tasks';
import { createRemindersApi, type RemindersDatabasesLike } from './reminders';

/**
 * PR6 task 6.5 (design D2/D5 — API-key repo) — the narrow due query and the
 * send-then-mark write, asserted at the wire level: the fake records the
 * exact JSON Appwrite receives, never mocking the SDK (the fake-Databases
 * precedent from `appwrite/telegram.test.ts`).
 *
 * Spec: `reminder-delivery` → Poll cadence ("Delivered near schedule" needs
 * the query to see every candidate inside the window). Ordering matters too:
 * `date` then `time` ascending, page of 100 (design D2 query).
 */

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

class FakeDatabases implements RemindersDatabasesLike {
  listCalls: ListCall[] = [];
  updateCalls: UpdateCall[] = [];
  nextList: { total: number; documents: RawDocument[] } = {
    total: 0,
    documents: [],
  };

  async listDocuments(
    databaseId: string,
    collectionId: string,
    queries: string[] = [],
  ): Promise<{ total: number; documents: RawDocument[] }> {
    this.listCalls.push({ databaseId, collectionId, queries });
    return this.nextList;
  }

  async updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
  ): Promise<RawDocument> {
    this.updateCalls.push({ databaseId, collectionId, documentId, data });
    return { $id: documentId, ...(data ?? {}) };
  }
}

function parsedQueries(call: ListCall | undefined): Array<
  Record<string, unknown>
> {
  return (call?.queries ?? []).map((query) => JSON.parse(query));
}

const config = { databaseId: 'agenda', tasksCollectionId: 'tasks' };

describe('listDue (spec reminder-delivery → Poll cadence)', () => {
  it('sends the exact narrow query: status, date window, ordering, limit', async () => {
    const fake = new FakeDatabases();
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => [],
      getByUser: async () => null,
      deactivate: async () => ({ $id: '' }),
    });

    await api.listDue('2026-10-03T10:00', '2026-10-04T10:00');

    expect(fake.listCalls).toHaveLength(1);
    expect(fake.listCalls[0]).toMatchObject({
      databaseId: 'agenda',
      collectionId: 'tasks',
    });
    expect(parsedQueries(fake.listCalls[0])).toEqual([
      { method: 'equal', attribute: 'status', values: ['open', 'in_progress'] },
      {
        method: 'between',
        attribute: 'date',
        values: ['2026-10-03', '2026-10-04'],
      },
      { method: 'orderAsc', attribute: 'date' },
      { method: 'orderAsc', attribute: 'time' },
      { method: 'limit', values: [100] },
    ]);
  });

  it('maps raw documents into scheduler candidates', async () => {
    const fake = new FakeDatabases();
    fake.nextList = {
      total: 2,
      documents: [
        {
          $id: 'rec-1',
          type: 'task',
          date: '2026-10-04',
          time: '09:00',
          status: 'open',
          createdBy: 'user-a',
          title: 'Pagar el agua',
          notified: false,
        },
        {
          $id: 'rec-2',
          type: 'note',
          date: '2026-10-04',
          time: '09:30',
          status: 'in_progress',
          createdBy: 'user-b',
          title: 'Llamar a B',
          // legacy rows carry no `notified` attribute yet
        },
      ],
    };
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => [],
      getByUser: async () => null,
      deactivate: async () => ({ $id: '' }),
    });

    const due = await api.listDue('2026-10-03T10:00', '2026-10-04T10:00');

    expect(due).toEqual([
      {
        $id: 'rec-1',
        type: 'task',
        title: 'Pagar el agua',
        date: '2026-10-04',
        time: '09:00',
        status: 'open',
        createdBy: 'user-a',
        notified: false,
      },
      {
        $id: 'rec-2',
        type: 'note',
        title: 'Llamar a B',
        date: '2026-10-04',
        time: '09:30',
        status: 'in_progress',
        createdBy: 'user-b',
        notified: null,
      },
    ]);
  });
});

describe('markNotified (spec reminder-delivery → Notified marking)', () => {
  it('writes notified: true on the delivered record only', async () => {
    const fake = new FakeDatabases();
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => [],
      getByUser: async () => null,
      deactivate: async () => ({ $id: '' }),
    });

    await api.markNotified('rec-1');

    expect(fake.updateCalls).toEqual([
      {
        databaseId: 'agenda',
        collectionId: 'tasks',
        documentId: 'rec-1',
        data: { notified: true },
      },
    ]);
  });
});

describe('listActiveSubs (design D2 data flow — creator → chat map)', () => {
  it('delegates to the subscription source without re-querying tasks', async () => {
    const fake = new FakeDatabases();
    const subs: ActiveSubscription[] = [
      { userId: 'user-a', chatId: '555000111' },
      { userId: 'user-b', chatId: '555000222' },
    ];
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => subs,
      getByUser: async () => null,
      deactivate: async () => ({ $id: '' }),
    });

    await expect(api.listActiveSubs()).resolves.toEqual(subs);
    expect(fake.listCalls).toHaveLength(0);
    expect(fake.updateCalls).toHaveLength(0);
  });
});

describe('deactivate (spec telegram-linking → Deactivated subscription on block)', () => {
  it('resolves the creator row and deactivates it by document id', async () => {
    const fake = new FakeDatabases();
    const calls: string[] = [];
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => [],
      getByUser: async (userId: string) => {
        calls.push(`get:${userId}`);
        return userId === 'user-a' ? { $id: 'sub-1' } : null;
      },
      deactivate: async (documentId: string) => {
        calls.push(`deact:${documentId}`);
        return { $id: documentId };
      },
    });

    await api.deactivate('user-a');

    expect(calls).toEqual(['get:user-a', 'deact:sub-1']);
    // No task write — blocking touches the subscription, never the record.
    expect(fake.listCalls).toHaveLength(0);
    expect(fake.updateCalls).toHaveLength(0);
  });

  it('does nothing when the creator holds no subscription row', async () => {
    const fake = new FakeDatabases();
    const calls: string[] = [];
    const api = createRemindersApi(fake, config, {
      listActiveSubs: async () => [],
      getByUser: async (userId: string) => {
        calls.push(`get:${userId}`);
        return null;
      },
      deactivate: async (documentId: string) => {
        calls.push(`deact:${documentId}`);
        return { $id: documentId };
      },
    });

    await api.deactivate('user-ghost');

    expect(calls).toEqual(['get:user-ghost']);
  });
});
