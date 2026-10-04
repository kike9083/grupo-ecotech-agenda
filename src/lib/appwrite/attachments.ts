import { ID, Permission, Query, Role } from 'node-appwrite';
import type { AttachmentKind } from '@/lib/attachments';
import { toDomainError } from './errors';

/**
 * `attachments` data + storage access (PR5 task 5.5, design D3): one module,
 * injected `Databases` and `Storage`, zero network in tests (design D5). Every
 * call runs server-side — the browser only ever sees `/api/attachments/*`.
 *
 * Permission model mirrors `tasks` (spec `attachments` → "Attachment
 * visibility"): collection-level `create("users")` + `read("team:admins")`,
 * document/file-level `read`/`write("user:<owner>")`. The `ownerId` is the
 * PARENT record's creator, so an admin attaching to someone else's record
 * still produces an attachment the record owner can read and delete.
 */

/** The provisioned ids (design D3) — fixed, no extra env contract. */
export const ATTACHMENTS_BUCKET_ID = 'agenda-attachments';
export const ATTACHMENTS_COLLECTION_ID = 'attachments';

/** A stored document as returned by Appwrite. */
export interface RawDocument {
  $id: string;
  [key: string]: unknown;
}

/** A stored file as returned by Appwrite Storage. */
export interface RawFile {
  $id: string;
  [key: string]: unknown;
}

/** Minimal structural view of `Databases` so tests inject a fake (design D5). */
export interface AttachmentDatabasesLike {
  createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ): Promise<RawDocument>;
  listDocuments(
    databaseId: string,
    collectionId: string,
    queries?: string[],
  ): Promise<{ total: number; documents: RawDocument[] }>;
  getDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
  ): Promise<RawDocument>;
  deleteDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
  ): Promise<unknown>;
}

/** Minimal structural view of `Storage` so tests inject a fake (design D5). */
export interface AttachmentStorageLike {
  createFile(
    bucketId: string,
    fileId: string,
    file: File,
    permissions?: string[],
  ): Promise<RawFile>;
  getFileView(bucketId: string, fileId: string): Promise<ArrayBuffer>;
  deleteFile(bucketId: string, fileId: string): Promise<unknown>;
}

/** Identifiers of the provisioned Appwrite resources (design D3). */
export interface AttachmentsConfig {
  databaseId: string;
  bucketId: string;
  collectionId: string;
}

/** The stored `attachments` shape. */
export interface AttachmentRecord {
  recordId: string;
  fileId: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  ownerId: string;
}

/** Read model — the record plus Appwrite's `$id`/`$createdAt`. */
export interface Attachment extends AttachmentRecord {
  $id: string;
  $createdAt: string;
}

function toAttachment(doc: RawDocument): Attachment {
  return {
    $id: doc.$id,
    $createdAt: typeof doc.$createdAt === 'string' ? doc.$createdAt : '',
    recordId: doc.recordId as string,
    fileId: doc.fileId as string,
    kind: doc.kind as AttachmentKind,
    name: doc.name as string,
    mimeType: doc.mimeType as string,
    size: doc.size as number,
    ownerId: doc.ownerId as string,
  };
}

/** Owner-scoped document/file grants — never a `team:` role (F3b trap). */
function ownerPermissions(ownerId: string): string[] {
  return [
    Permission.read(Role.user(ownerId)),
    Permission.write(Role.user(ownerId)),
  ];
}

/**
 * Factory that binds injected clients to the provisioned ids. Callers inject
 * the API-key client for writes/deletes (design D3: storage ops use the API
 * key after app-level authorization) and the session client for the proxy's
 * authorized read — this module never constructs either.
 */
export function createAttachmentsApi(
  databases: AttachmentDatabasesLike,
  storage: AttachmentStorageLike,
  config: AttachmentsConfig,
) {
  return {
    /** Persists the metadata row with owner-mirrored permissions. */
    async createAttachment(
      record: AttachmentRecord,
      documentId: string = ID.unique(),
    ): Promise<Attachment> {
      try {
        const doc = await databases.createDocument(
          config.databaseId,
          config.collectionId,
          documentId,
          { ...record },
          ownerPermissions(record.ownerId),
        );
        return toAttachment(doc);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Stores the binary in the bucket with owner-mirrored permissions. */
    async createAttachmentFile(
      file: File,
      ownerId: string,
    ): Promise<{ fileId: string }> {
      try {
        const fileId = ID.unique();
        await storage.createFile(
          config.bucketId,
          fileId,
          file,
          ownerPermissions(ownerId),
        );
        return { fileId };
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Every attachment of one record, oldest first (spec → display). */
    async listAttachments(recordId: string): Promise<Attachment[]> {
      try {
        const result = await databases.listDocuments(
          config.databaseId,
          config.collectionId,
          [
            Query.equal('recordId', recordId),
            Query.orderAsc('$createdAt'),
          ],
        );
        return result.documents.map(toAttachment);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Batched variant for a list page — one query for many records. */
    async listAttachmentsForRecords(
      recordIds: string[],
    ): Promise<Attachment[]> {
      if (recordIds.length === 0) {
        return [];
      }
      try {
        const result = await databases.listDocuments(
          config.databaseId,
          config.collectionId,
          [
            Query.equal('recordId', recordIds),
            Query.orderAsc('$createdAt'),
          ],
        );
        return result.documents.map(toAttachment);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Metadata by document id; null when missing (delete authz seam). */
    async getAttachment(documentId: string): Promise<Attachment | null> {
      try {
        return toAttachment(
          await databases.getDocument(
            config.databaseId,
            config.collectionId,
            documentId,
          ),
        );
      } catch (error) {
        const domain = toDomainError(error);
        if (domain.kind === 'not-found') {
          return null;
        }
        throw domain;
      }
    },

    /** Metadata by unique `fileId`; null when the caller cannot see it. */
    async getAttachmentByFileId(fileId: string): Promise<Attachment | null> {
      try {
        const result = await databases.listDocuments(
          config.databaseId,
          config.collectionId,
          [Query.equal('fileId', fileId), Query.limit(1)],
        );
        const doc = result.documents[0];
        return doc === undefined ? null : toAttachment(doc);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Removes the stored binary. */
    async deleteAttachmentFile(fileId: string): Promise<void> {
      try {
        await storage.deleteFile(config.bucketId, fileId);
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Removes the metadata row. */
    async deleteAttachmentDocument(documentId: string): Promise<void> {
      try {
        await databases.deleteDocument(
          config.databaseId,
          config.collectionId,
          documentId,
        );
      } catch (error) {
        throw toDomainError(error);
      }
    },

    /** Raw bytes for the proxy stream (API-key storage view). */
    async readAttachmentFile(fileId: string): Promise<ArrayBuffer> {
      try {
        return await storage.getFileView(config.bucketId, fileId);
      } catch (error) {
        throw toDomainError(error);
      }
    },
  };
}

export type AttachmentsApi = ReturnType<typeof createAttachmentsApi>;
