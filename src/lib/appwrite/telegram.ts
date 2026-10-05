import { ID, Permission, Query, Role } from 'node-appwrite';
import { toDomainError } from './errors';

/**
 * `telegram_subscriptions` data access (design D7): one module, an INJECTED
 * client, zero network in tests. The caller picks the credential — the session
 * client for the owner paths (mint/status/unlink, Appwrite enforces the
 * document grants) and the API-key client for the system paths (callback
 * exchange, active-subscription listing for the scheduler).
 *
 * One document per user, enforced by the `user_id` UNIQUE index; `''` means
 * unlinked everywhere (design D7 attribute table).
 */

/** A stored subscription document as returned by Appwrite. */
export interface TelegramRawDocument {
  $id: string;
  [key: string]: unknown;
}

/** Minimal structural view of `Databases` so tests inject a fake (design D5). */
export interface TelegramDatabasesLike {
  createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ): Promise<TelegramRawDocument>;
  listDocuments(
    databaseId: string,
    collectionId: string,
    queries?: string[],
  ): Promise<{ total: number; documents: TelegramRawDocument[] }>;
  updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data?: Record<string, unknown>,
    permissions?: string[],
  ): Promise<TelegramRawDocument>;
}

/** Identifiers of the provisioned Appwrite resources (design D7). */
export interface TelegramConfig {
  databaseId: string;
  collectionId: string;
}

/** Read model of a subscription — chat id is never exposed to the UI (D8). */
export interface TelegramSubscription {
  $id: string;
  userId: string;
  chatId: string;
  active: boolean;
  token: string;
  tokenExpiresAt: string;
}

/** Creator → chat id map the scheduler delivers to (design D2 data flow). */
export interface ActiveSubscription {
  userId: string;
  chatId: string;
}

/** Page size for the active-subscription listing (read fully via cursor). */
export const SUBSCRIPTION_PAGE_SIZE = 100;

/**
 * Fixed collection id, created by `scripts/provision-reminders.ts` (design D7):
 * same convention as `ATTACHMENTS_COLLECTION_ID` — no env var per resource.
 */
export const TELEGRAM_SUBSCRIPTIONS_COLLECTION_ID = 'telegram_subscriptions';

function toSubscription(doc: TelegramRawDocument): TelegramSubscription {
  return {
    $id: doc.$id,
    userId: typeof doc.userId === 'string' ? doc.userId : '',
    chatId: typeof doc.chatId === 'string' ? doc.chatId : '',
    active: doc.active === true,
    token: typeof doc.token === 'string' ? doc.token : '',
    tokenExpiresAt:
      typeof doc.tokenExpiresAt === 'string' ? doc.tokenExpiresAt : '',
  };
}

/**
 * Factory that binds an injected `Databases` to the provisioned ids — the
 * session client for owner paths, the API-key client for system paths
 * (design D7 client split); this module never constructs either.
 */
export function createTelegramSubscriptionsApi(
  databases: TelegramDatabasesLike,
  config: TelegramConfig,
) {
  async function getOne(queries: string[]): Promise<TelegramSubscription | null> {
    const result = await databases.listDocuments(
      config.databaseId,
      config.collectionId,
      queries,
    );
    const doc = result.documents[0];
    return doc === undefined ? null : toSubscription(doc);
  }

  async function patch(
    documentId: string,
    data: Record<string, unknown>,
  ): Promise<TelegramSubscription> {
    const doc = await databases.updateDocument(
      config.databaseId,
      config.collectionId,
      documentId,
      data,
    );
    return toSubscription(doc);
  }

  return {
    /**
     * Per-user upsert: returns the caller's document, creating it on first
     * use with the unlinked defaults. Creation carries owner-only document
     * grants (design D7) — admins read through the collection-level
     * `team:admins` grant, because Appwrite rejects a session that grants a
     * role it does not hold (verify F3b).
     */
    async upsertSubscription(userId: string): Promise<TelegramSubscription> {
      try {
        const existing = await getOne([
          Query.equal('userId', userId),
          Query.limit(1),
        ]);
        if (existing !== null) {
          return existing;
        }

        const data = {
          userId,
          chatId: '',
          active: false,
          token: '',
          tokenExpiresAt: '',
        };
        const doc = await databases.createDocument(
          config.databaseId,
          config.collectionId,
          ID.unique(),
          data,
          [
            Permission.read(Role.user(userId)),
            Permission.write(Role.user(userId)),
          ],
        );
        return toSubscription(doc);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Current status of one user's link (spec `telegram-linking` → "Status shown"). */
    async getByUser(userId: string): Promise<TelegramSubscription | null> {
      try {
        return await getOne([Query.equal('userId', userId), Query.limit(1)]);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Exchange lookup (design D4): exact match on the 43-char random token
     * through the `token` key index. An empty token never queries — every
     * unlinked document stores `''`, so matching it would return a random
     * subscription.
     */
    async findByToken(token: string): Promise<TelegramSubscription | null> {
      if (token === '') {
        return null;
      }
      try {
        return await getOne([Query.equal('token', token), Query.limit(1)]);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Active links only (design D7 — API-key client): the scheduler's
     * creator → chatId map. A deactivated or unlinked subscription is
     * invisible here, which is what stops further sends after a 403 block
     * (spec `telegram-linking` → "Blocked bot deactivates").
     *
     * Pages until a short read so the delivery map is never silently capped
     * by Appwrite's per-request limit.
     */
    async listActiveSubs(): Promise<ActiveSubscription[]> {
      try {
        const active: ActiveSubscription[] = [];
        let cursor: string | undefined;

        for (;;) {
          const queries = [
            Query.equal('active', true),
            Query.limit(SUBSCRIPTION_PAGE_SIZE),
          ];
          if (cursor !== undefined) {
            queries.push(Query.cursorAfter(cursor));
          }

          const result = await databases.listDocuments(
            config.databaseId,
            config.collectionId,
            queries,
          );
          const docs = result.documents.map(toSubscription);
          for (const sub of docs) {
            if (sub.chatId !== '') {
              active.push({ userId: sub.userId, chatId: sub.chatId });
            }
          }

          const last = docs[docs.length - 1];
          if (docs.length < SUBSCRIPTION_PAGE_SIZE || last === undefined) {
            return active;
          }
          cursor = last.$id;
        }
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Successful exchange (spec `telegram-linking` → "Successful exchange"):
     * store the chat id, activate, and consume the token in one update —
     * consumption IS invalidation (design D4).
     */
    async link(
      documentId: string,
      chatId: string,
    ): Promise<TelegramSubscription> {
      try {
        return await patch(documentId, {
          chatId,
          active: true,
          token: '',
          tokenExpiresAt: '',
        });
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Telegram 403 (spec `telegram-linking` → "Blocked bot deactivates"):
     * deactivate only — the chat id stays so the linking page can show the
     * re-link prompt instead of pretending the user never linked.
     */
    async deactivate(documentId: string): Promise<TelegramSubscription> {
      try {
        return await patch(documentId, { active: false });
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /**
     * Unlink (spec `telegram-linking` → "Unlink"): clear the binding and any
     * pending token. The `userId` is left alone — the document is the
     * user's one-per-user row.
     */
    async unlink(documentId: string): Promise<TelegramSubscription> {
      try {
        return await patch(documentId, {
          chatId: '',
          active: false,
          token: '',
          tokenExpiresAt: '',
        });
      } catch (error) {
        throw toDomainError(error);
      }
    },
  };
}

export type TelegramSubscriptionsApi = ReturnType<
  typeof createTelegramSubscriptionsApi
>;
