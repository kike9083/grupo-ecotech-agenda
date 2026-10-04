import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
  type Attachment,
  type AttachmentDatabasesLike,
  type AttachmentStorageLike,
  type AttachmentsConfig,
  type RawDocument,
  type RawFile,
} from './attachments';

/**
 * RED seam for PR5 task 5.4 (spec `attachments` → "Attachment visibility"):
 * the attachment data/storage access runs against hand-written fakes that
 * record the wire payload, so the permission mirror and query shapes are
 * asserted without network (design D5 pattern).
 */

const config: AttachmentsConfig = {
  databaseId: 'agenda',
  bucketId: ATTACHMENTS_BUCKET_ID,
  collectionId: ATTACHMENTS_COLLECTION_ID,
};

const record = {
  recordId: 'task-1',
  fileId: 'file-1',
  kind: 'image' as const,
  name: 'foto.jpg',
  mimeType: 'image/jpeg',
  size: 1234,
  ownerId: 'user-123',
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

class FakeDatabases implements AttachmentDatabasesLike {
  createCalls: CreateCall[] = [];
  listCalls: ListCall[] = [];
  getCalls: string[] = [];
  deleteCalls: string[] = [];
  nextError: unknown = undefined;
  nextList: { total: number; documents: RawDocument[] } = {
    total: 0,
    documents: [],
  };
  nextDocument: RawDocument | null = null;

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
  ): Promise<RawDocument> {
    this.createCalls.push({
      databaseId,
      collectionId,
      documentId,
      data,
      permissions,
    });
    this.takeError();
    return { $id: documentId, $createdAt: '2026-10-04T10:00:00.000+00:00', ...data };
  }

  async listDocuments(
    databaseId: string,
    collectionId: string,
    queries: string[] = [],
  ): Promise<{ total: number; documents: RawDocument[] }> {
    this.listCalls.push({ databaseId, collectionId, queries });
    this.takeError();
    return this.nextList;
  }

  async getDocument(
    _databaseId: string,
    _collectionId: string,
    documentId: string,
  ): Promise<RawDocument> {
    this.getCalls.push(documentId);
    this.takeError();
    if (this.nextDocument === null) {
      throw { code: 404, type: 'document_not_found', message: 'not found' };
    }
    return this.nextDocument;
  }

  async deleteDocument(
    _databaseId: string,
    _collectionId: string,
    documentId: string,
  ): Promise<unknown> {
    this.deleteCalls.push(documentId);
    this.takeError();
    return {};
  }
}

interface FileCall {
  bucketId: string;
  fileId: string;
  file: File;
  permissions: string[] | undefined;
}

class FakeStorage implements AttachmentStorageLike {
  fileCalls: FileCall[] = [];
  deleteCalls: Array<{ bucketId: string; fileId: string }> = [];
  viewCalls: Array<{ bucketId: string; fileId: string }> = [];
  bytes = new Uint8Array([1, 2, 3]).buffer;
  nextError: unknown = undefined;

  private takeError(): void {
    if (this.nextError !== undefined) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
  }

  async createFile(
    bucketId: string,
    fileId: string,
    file: File,
    permissions?: string[],
  ): Promise<RawFile> {
    this.fileCalls.push({ bucketId, fileId, file, permissions });
    this.takeError();
    return { $id: fileId };
  }

  async getFileView(bucketId: string, fileId: string): Promise<ArrayBuffer> {
    this.viewCalls.push({ bucketId, fileId });
    this.takeError();
    return this.bytes;
  }

  async deleteFile(bucketId: string, fileId: string): Promise<unknown> {
    this.deleteCalls.push({ bucketId, fileId });
    this.takeError();
    return {};
  }
}

function storedAttachment(overrides: Record<string, unknown> = {}): RawDocument {
  return {
    $id: 'att-1',
    $createdAt: '2026-10-04T10:00:00.000+00:00',
    ...record,
    ...overrides,
  };
}

function parsedQueries(call: ListCall | undefined): Array<Record<string, unknown>> {
  return (call?.queries ?? []).map((query) => JSON.parse(query));
}

describe('createAttachment (spec attachments → Attachment visibility)', () => {
  it('mirrors the owner permissions and persists the metadata payload', async () => {
    const databases = new FakeDatabases();
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    const attachment = await api.createAttachment(record, 'att-1');

    const call = databases.createCalls[0];
    expect(call.databaseId).toBe('agenda');
    expect(call.collectionId).toBe('attachments');
    expect(call.documentId).toBe('att-1');
    expect(call.data).toEqual(record);
    // F3b: creator-only grants — admins read via the collection-level grant.
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
    ]);
    expect(attachment).toEqual({
      $id: 'att-1',
      $createdAt: '2026-10-04T10:00:00.000+00:00',
      ...record,
    });
  });

  it('generates a document id when none is given', async () => {
    const databases = new FakeDatabases();
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    await api.createAttachment(record);

    expect(databases.createCalls[0].documentId).not.toBe('');
  });

  it('maps a storage failure to a typed domain error', async () => {
    const databases = new FakeDatabases();
    databases.nextError = { code: 400, type: 'document_invalid_data', message: 'bad' };
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    await expect(api.createAttachment(record)).rejects.toMatchObject({
      kind: 'validation',
    });
  });
});

describe('createAttachmentFile (spec attachments → Attachment upload)', () => {
  it('stores the file in the bucket with owner permissions and returns its id', async () => {
    const storage = new FakeStorage();
    const api = createAttachmentsApi(new FakeDatabases(), storage, config);
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', {
      type: 'image/jpeg',
    });

    const { fileId } = await api.createAttachmentFile(file, 'user-123');

    const call = storage.fileCalls[0];
    expect(call.bucketId).toBe(ATTACHMENTS_BUCKET_ID);
    expect(call.fileId).not.toBe('');
    expect(call.file).toBe(file);
    expect(call.permissions).toEqual([
      'read("user:user-123")',
      'write("user:user-123")',
    ]);
    expect(fileId).toBe(call.fileId);
  });
});

describe('listAttachments (spec attachments → Attachment display)', () => {
  it('filters by recordId and orders by creation', async () => {
    const databases = new FakeDatabases();
    databases.nextList = { total: 1, documents: [storedAttachment()] };
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    const attachments = await api.listAttachments('task-1');

    const queries = parsedQueries(databases.listCalls[0]);
    expect(queries).toEqual(
      expect.arrayContaining([
        { method: 'equal', attribute: 'recordId', values: ['task-1'] },
        { method: 'orderAsc', attribute: '$createdAt' },
      ]),
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject<Partial<Attachment>>({
      fileId: 'file-1',
      kind: 'image',
      mimeType: 'image/jpeg',
      ownerId: 'user-123',
    });
  });

  it('batches several records into one query and skips an empty set', async () => {
    const databases = new FakeDatabases();
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    expect(await api.listAttachmentsForRecords([])).toEqual([]);
    expect(databases.listCalls).toHaveLength(0);

    databases.nextList = { total: 0, documents: [] };
    await api.listAttachmentsForRecords(['task-1', 'task-2']);

    expect(parsedQueries(databases.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'equal', attribute: 'recordId', values: ['task-1', 'task-2'] },
      ]),
    );
  });
});

describe('getAttachment / getAttachmentByFileId', () => {
  it('returns the mapped document by id and null on 404', async () => {
    const databases = new FakeDatabases();
    databases.nextDocument = storedAttachment();
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    const found = await api.getAttachment('att-1');
    expect(found?.fileId).toBe('file-1');

    databases.nextDocument = null;
    expect(await api.getAttachment('missing')).toBeNull();
  });

  it('looks a document up by its unique fileId for the proxy route', async () => {
    const databases = new FakeDatabases();
    databases.nextList = { total: 1, documents: [storedAttachment()] };
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    const found = await api.getAttachmentByFileId('file-1');

    expect(parsedQueries(databases.listCalls[0])).toEqual(
      expect.arrayContaining([
        { method: 'equal', attribute: 'fileId', values: ['file-1'] },
        { method: 'limit', values: [1] },
      ]),
    );
    expect(found?.mimeType).toBe('image/jpeg');
  });

  it('returns null when the fileId is unknown', async () => {
    const databases = new FakeDatabases();
    databases.nextList = { total: 0, documents: [] };
    const api = createAttachmentsApi(databases, new FakeStorage(), config);

    expect(await api.getAttachmentByFileId('nope')).toBeNull();
  });
});

describe('deleteAttachmentFile / deleteAttachmentDocument / readAttachmentFile', () => {
  it('deletes the stored file and the metadata row', async () => {
    const databases = new FakeDatabases();
    const storage = new FakeStorage();
    const api = createAttachmentsApi(databases, storage, config);

    await api.deleteAttachmentFile('file-1');
    await api.deleteAttachmentDocument('att-1');

    expect(storage.deleteCalls[0]).toEqual({
      bucketId: ATTACHMENTS_BUCKET_ID,
      fileId: 'file-1',
    });
    expect(databases.deleteCalls).toEqual(['att-1']);
  });

  it('reads the raw bytes through the API-key storage view', async () => {
    const storage = new FakeStorage();
    const api = createAttachmentsApi(new FakeDatabases(), storage, config);

    const bytes = await api.readAttachmentFile('file-1');

    expect(storage.viewCalls[0]).toEqual({
      bucketId: ATTACHMENTS_BUCKET_ID,
      fileId: 'file-1',
    });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
