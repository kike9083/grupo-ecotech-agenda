import { Query } from 'node-appwrite';
import type { ReminderCandidate } from '../reminders';
import type { ActiveSubscription } from './telegram';
import type { RawDocument } from './tasks';

/**
 * Reminder scheduler data access (design D2/D5) — the API-key side of the
 * split: `createAdminClient()` builds the `Databases` it is handed, this
 * module never does (same rule as `appwrite/telegram.ts`). Tests inject a fake
 * and assert the exact wire JSON instead of mocking the SDK.
 *
 * The due query rides the existing `date_time` index and narrows hard:
 * open/in-progress only, date inside the inclusive late window, ascending by
 * date then time, one page of 100 (candidate set = one day for a handful of
 * linked users — the exact minute bounds belong to `isEligible`, design D2).
 */

/** Structural slice of `Databases` this API needs — tests inject a fake. */
export type RemindersDatabasesLike = {
  listDocuments(
    databaseId: string,
    collectionId: string,
    queries?: string[],
  ): Promise<{ total: number; documents: RawDocument[] }>;
  updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
    permissions?: string[],
  ): Promise<RawDocument>;
};

/** Provisioned Appwrite identifiers (env contract, design D7). */
export interface RemindersConfig {
  databaseId: string;
  tasksCollectionId: string;
}

/**
 * Seam onto the linked-chats source: the real one is the Telegram
 * subscriptions API (`active: true`, cursor-paged), a fake in tests. Keeping
 * it a parameter means this module never constructs a provider client.
 * `getByUser` + `deactivate` cover the 403 path (D5): resolve the creator's
 * row, then flip `active: false` on it (chat id retained).
 */
export interface SubscriptionSource {
  listActiveSubs(): Promise<ActiveSubscription[]>;
  /** Creator's subscription row (structural — the fake needs no provider type). */
  getByUser(userId: string): Promise<{ $id: string } | null>;
  /** Flip `active: false` on the document id returned by `getByUser`. */
  deactivate(documentId: string): Promise<unknown>;
}

/** One page of candidates per poll — enough for a day of linked users. */
export const DUE_PAGE_SIZE = 100;

function toCandidate(doc: RawDocument): ReminderCandidate {
  return {
    $id: doc.$id,
    type: typeof doc.type === 'string' ? doc.type : 'task',
    title: typeof doc.title === 'string' ? doc.title : '',
    date: typeof doc.date === 'string' ? doc.date : '',
    time: typeof doc.time === 'string' ? doc.time : '',
    status: typeof doc.status === 'string' ? doc.status : '',
    createdBy: typeof doc.createdBy === 'string' ? doc.createdBy : '',
    notified: typeof doc.notified === 'boolean' ? doc.notified : null,
  };
}

export function createRemindersApi(
  databases: RemindersDatabasesLike,
  config: RemindersConfig,
  subscriptions: SubscriptionSource,
) {
  return {
    /** Due candidates inside `[windowStart, nowWall]` (day bounds inclusive). */
    async listDue(
      windowStart: string,
      nowWall: string,
    ): Promise<ReminderCandidate[]> {
      const result = await databases.listDocuments(
        config.databaseId,
        config.tasksCollectionId,
        [
          Query.equal('status', ['open', 'in_progress']),
          Query.between('date', windowStart.slice(0, 10), nowWall.slice(0, 10)),
          Query.orderAsc('date'),
          Query.orderAsc('time'),
          Query.limit(DUE_PAGE_SIZE),
        ],
      );
      return result.documents.map(toCandidate);
    },

    /**
     * Send-then-mark write (design D5): called ONLY after a `delivered`
     * outcome, one record at a time — never batched.
     */
    async markNotified(id: string): Promise<void> {
      await databases.updateDocument(
        config.databaseId,
        config.tasksCollectionId,
        id,
        { notified: true },
      );
    },

    /** Active linked chats, delegated to the injected subscription source. */
    async listActiveSubs(): Promise<ActiveSubscription[]> {
      return subscriptions.listActiveSubs();
    },

    /**
     * 403 from the provider (spec `telegram-linking` → "Deactivated
     * subscription on block"): resolve the creator's row by user id, then
     * deactivate it. A missing row is a no-op — nothing to deactivate.
     */
    async deactivate(userId: string): Promise<void> {
      const subscription = await subscriptions.getByUser(userId);
      if (subscription !== null) {
        await subscriptions.deactivate(subscription.$id);
      }
    },
  };
}
