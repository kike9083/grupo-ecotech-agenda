import { describe, expect, it } from 'vitest';
import type { Attachment, AttachmentRecord } from '@/lib/appwrite/attachments';
import { ATTACHMENT_ERROR_MESSAGES, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import {
  ATTACHMENT_FAILURE_MESSAGES,
  attachmentFailureStatus,
  performDelete,
  performUpload,
  type DeleteDeps,
  type UploadDeps,
} from './attachment-flow';

/**
 * RED seam for PR6 task 6.1 (spec `attachments` → "Upload failure handling",
 * "Attachment deletion") and PR7 task 7.5 ("Attachment visibility"): the flow
 * decides authz, validation, the file+doc write and the rollback, all against
 * injected fakes so no network is touched.
 */

const recordOwner = 'user-owner';
const uploader = 'user-owner';
const adminUploader = 'user-admin';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    $id: 'att-1',
    $createdAt: '2026-10-04T10:00:00.000+00:00',
    recordId: 'task-1',
    fileId: 'file-1',
    kind: 'image',
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    ownerId: recordOwner,
    ...overrides,
  };
}

interface UploadHarness extends UploadDeps {
  fileCalls: Array<{ name: string; type: string; ownerId: string }>;
  documentCalls: AttachmentRecord[];
  deletedFiles: string[];
}

function makeUploadHarness(options: {
  recordOwner?: string | null;
  recordError?: unknown;
  fileError?: unknown;
  documentError?: unknown;
} = {}): UploadHarness {
  const harness: UploadHarness = {
    fileCalls: [],
    documentCalls: [],
    deletedFiles: [],
    getRecordOwner: async () => {
      if (options.recordError !== undefined) {
        throw options.recordError;
      }
      return options.recordOwner === undefined ? recordOwner : options.recordOwner;
    },
    createFile: async (input) => {
      if (options.fileError !== undefined) {
        throw options.fileError;
      }
      harness.fileCalls.push({ name: input.name, type: input.type, ownerId: input.ownerId });
      return { fileId: 'file-1' };
    },
    createDocument: async (record) => {
      if (options.documentError !== undefined) {
        throw options.documentError;
      }
      harness.documentCalls.push(record);
      return attachment(record);
    },
    deleteFile: async (fileId) => {
      harness.deletedFiles.push(fileId);
    },
  };
  return harness;
}

const validFile = {
  name: 'foto.jpg',
  type: 'image/jpeg',
  size: 1024,
  bytes: new Uint8Array([1, 2, 3]),
};

describe('performUpload (spec attachments → Attachment upload)', () => {
  it('stores the file then the metadata row with the record owner mirrored', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: validFile,
    });

    expect(result).toEqual({ ok: true, attachment: attachment() });
    expect(deps.fileCalls).toEqual([
      { name: 'foto.jpg', type: 'image/jpeg', ownerId: recordOwner },
    ]);
    expect(deps.documentCalls).toEqual([
      {
        recordId: 'task-1',
        fileId: 'file-1',
        kind: 'image',
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        ownerId: recordOwner,
      },
    ]);
  });

  it('rejects an oversized file without touching storage or the database', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: { ...validFile, size: MAX_ATTACHMENT_BYTES + 1 },
    });

    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(deps.fileCalls).toEqual([]);
    expect(deps.documentCalls).toEqual([]);
  });

  it('rejects an unsupported type without storing anything', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: { name: 'nota.txt', type: 'text/plain', size: 10, bytes: new Uint8Array() },
    });

    expect(result).toEqual({ ok: false, reason: 'unsupported-type' });
    expect(deps.fileCalls).toEqual([]);
  });

  it('stores a PDF as a document attachment', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: {
        name: 'informe.pdf',
        type: 'application/pdf',
        size: 2048,
        bytes: new Uint8Array([1]),
      },
    });

    expect(result.ok).toBe(true);
    expect(deps.fileCalls).toEqual([
      { name: 'informe.pdf', type: 'application/pdf', ownerId: recordOwner },
    ]);
    expect(deps.documentCalls[0]).toMatchObject({
      kind: 'document',
      name: 'informe.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('rejects an unknown parent record as not-found', async () => {
    const deps = makeUploadHarness({ recordOwner: null });

    const result = await performUpload(deps, {
      recordId: 'missing',
      ownerId: uploader,
      admin: false,
      file: validFile,
    });

    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(deps.fileCalls).toEqual([]);
  });

  it('denies a peer who is neither the owner nor an admin', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: 'user-peer',
      admin: false,
      file: validFile,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(deps.fileCalls).toEqual([]);
  });

  it('lets an admin attach to someone else and still mirrors the record owner', async () => {
    const deps = makeUploadHarness();

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: adminUploader,
      admin: true,
      file: validFile,
    });

    expect(result.ok).toBe(true);
    expect(deps.fileCalls[0].ownerId).toBe(recordOwner);
    expect(deps.documentCalls[0].ownerId).toBe(recordOwner);
  });

  it('rolls the file back when the metadata write fails', async () => {
    const deps = makeUploadHarness({
      documentError: { code: 400, type: 'document_invalid_data', message: 'bad' },
    });

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: validFile,
    });

    expect(result).toEqual({ ok: false, reason: 'validation' });
    expect(deps.deletedFiles).toEqual(['file-1']);
    expect(deps.documentCalls).toEqual([]);
  });

  it('reports a storage failure without writing metadata', async () => {
    const deps = makeUploadHarness({
      fileError: { code: 401, type: 'user_session_expired', message: 'expired' },
    });

    const result = await performUpload(deps, {
      recordId: 'task-1',
      ownerId: uploader,
      admin: false,
      file: validFile,
    });

    expect(result).toEqual({ ok: false, reason: 'session-expired' });
    expect(deps.documentCalls).toEqual([]);
  });
});

interface DeleteHarness extends DeleteDeps {
  deletedFiles: string[];
  deletedDocuments: string[];
}

function makeDeleteHarness(options: {
  existing?: { fileId: string; ownerId: string } | null;
  fileError?: unknown;
} = {}): DeleteHarness {
  const harness: DeleteHarness = {
    deletedFiles: [],
    deletedDocuments: [],
    getAttachment: async () =>
      options.existing === undefined
        ? { fileId: 'file-1', ownerId: recordOwner }
        : options.existing,
    deleteFile: async (fileId) => {
      if (options.fileError !== undefined) {
        throw options.fileError;
      }
      harness.deletedFiles.push(fileId);
    },
    deleteDocument: async (documentId) => {
      harness.deletedDocuments.push(documentId);
    },
  };
  return harness;
}

describe('performDelete (spec attachments → Attachment deletion)', () => {
  it('removes the file and then the metadata row for the owner', async () => {
    const deps = makeDeleteHarness();

    const result = await performDelete(deps, {
      documentId: 'att-1',
      ownerId: uploader,
      admin: false,
    });

    expect(result).toEqual({ ok: true });
    expect(deps.deletedFiles).toEqual(['file-1']);
    expect(deps.deletedDocuments).toEqual(['att-1']);
  });

  it('returns not-found for an unknown document without deleting', async () => {
    const deps = makeDeleteHarness({ existing: null });

    const result = await performDelete(deps, {
      documentId: 'missing',
      ownerId: uploader,
      admin: false,
    });

    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(deps.deletedFiles).toEqual([]);
    expect(deps.deletedDocuments).toEqual([]);
  });

  it('denies a peer (spec → Peer isolation)', async () => {
    const deps = makeDeleteHarness();

    const result = await performDelete(deps, {
      documentId: 'att-1',
      ownerId: 'user-peer',
      admin: false,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(deps.deletedFiles).toEqual([]);
  });

  it('lets an admin delete a record owned by someone else (spec → Admin read)', async () => {
    const deps = makeDeleteHarness();

    const result = await performDelete(deps, {
      documentId: 'att-1',
      ownerId: adminUploader,
      admin: true,
    });

    expect(result).toEqual({ ok: true });
    expect(deps.deletedDocuments).toEqual(['att-1']);
  });

  it('keeps the metadata when the file delete fails, so state never points at a missing file', async () => {
    const deps = makeDeleteHarness({
      fileError: { code: 404, type: 'storage_file_not_found', message: 'gone' },
    });

    const result = await performDelete(deps, {
      documentId: 'att-1',
      ownerId: uploader,
      admin: false,
    });

    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(deps.deletedDocuments).toEqual([]);
  });
});

describe('failure mapping (route contract)', () => {
  it('maps every reason to the right HTTP status', () => {
    expect(attachmentFailureStatus('too-large')).toBe(400);
    expect(attachmentFailureStatus('unsupported-type')).toBe(400);
    expect(attachmentFailureStatus('validation')).toBe(400);
    expect(attachmentFailureStatus('unauthorized')).toBe(403);
    expect(attachmentFailureStatus('not-found')).toBe(404);
    expect(attachmentFailureStatus('session-expired')).toBe(401);
    expect(attachmentFailureStatus('unknown')).toBe(500);
  });

  it('carries Spanish copy for every reason', () => {
    expect(ATTACHMENT_FAILURE_MESSAGES['too-large']).toMatch(/demasiado grande/i);
    expect(ATTACHMENT_FAILURE_MESSAGES['unsupported-type']).toMatch(/no soportado/i);
    expect(ATTACHMENT_FAILURE_MESSAGES.unauthorized).toMatch(/permiso/i);
    expect(ATTACHMENT_FAILURE_MESSAGES['not-found']).toMatch(/encontr/i);
  });

  it('reuses the validation copy so route and form state the same cap', () => {
    expect(ATTACHMENT_FAILURE_MESSAGES['too-large']).toBe(
      ATTACHMENT_ERROR_MESSAGES['too-large'],
    );
    expect(ATTACHMENT_FAILURE_MESSAGES['unsupported-type']).toBe(
      ATTACHMENT_ERROR_MESSAGES['unsupported-type'],
    );
  });
});
