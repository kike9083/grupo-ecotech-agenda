import { describe, expect, it } from 'vitest';
import type { Attachment, AttachmentRecord } from '@/lib/appwrite/attachments';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { performUpload, type UploadInput, type UploadResult } from '@/lib/attachment-flow';
import {
  gateUploadRequest,
  handleUpload,
  readGatedUploadBody,
  rejectOversizedBody,
  type UploadRouteDeps,
} from './route';

/**
 * RED seam for PR6 task 6.4 (spec `attachments` → "Oversized or wrong type"):
 * the route handler wires the session + admin check to the real
 * `performUpload` flow and maps every failure to the right HTTP status and
 * Spanish message — with nothing stored on rejection.
 */

function attachment(record: AttachmentRecord): Attachment {
  return {
    $id: 'att-1',
    $createdAt: '2026-10-04T10:00:00.000+00:00',
    ...record,
  };
}

interface Harness {
  deps: UploadRouteDeps;
  files: Array<{ name: string; ownerId: string }>;
  documents: AttachmentRecord[];
}

function makeHarness(options: {
  user?: { id: string } | null;
  admin?: boolean;
  recordOwner?: string | null;
} = {}): Harness {
  const files: Harness['files'] = [];
  const documents: AttachmentRecord[] = [];

  const deps: UploadRouteDeps = {
    getSessionUser: async () =>
      options.user === undefined ? { id: 'user-owner' } : options.user,
    isAdmin: async () => options.admin ?? false,
    performUpload: (input: UploadInput): Promise<UploadResult> =>
      performUpload(
        {
          getRecordOwner: async () =>
            options.recordOwner === undefined ? 'user-owner' : options.recordOwner,
          createFile: async (fileInput) => {
            files.push({ name: fileInput.name, ownerId: fileInput.ownerId });
            return { fileId: 'file-1' };
          },
          createDocument: async (record) => {
            documents.push(record);
            return attachment(record);
          },
          deleteFile: async () => {},
        },
        input,
      ),
  };

  return { deps, files, documents };
}

const validFile = {
  name: 'foto.jpg',
  type: 'image/jpeg',
  size: 1024,
  bytes: new Uint8Array([1, 2, 3]),
};

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('handleUpload (spec attachments → Attachment upload)', () => {
  it('returns 401 without a session and stores nothing', async () => {
    const harness = makeHarness({ user: null });

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: validFile,
    });

    expect(response.status).toBe(401);
    expect(harness.files).toEqual([]);
  });

  it('stores a valid file and answers 201', async () => {
    const harness = makeHarness();

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: validFile,
    });

    expect(response.status).toBe(201);
    expect(harness.files).toEqual([{ name: 'foto.jpg', ownerId: 'user-owner' }]);
    expect((await body(response)).attachment).toBeDefined();
  });

  it('rejects an oversized file with 400 and nothing stored', async () => {
    const harness = makeHarness();

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: { ...validFile, size: MAX_ATTACHMENT_BYTES + 1 },
    });

    expect(response.status).toBe(400);
    expect(String((await body(response)).error)).toMatch(/demasiado grande/i);
    expect(harness.files).toEqual([]);
  });

  it('rejects an unsupported type with 400 and nothing stored', async () => {
    const harness = makeHarness();

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: { name: 'nota.txt', type: 'text/plain', size: 10, bytes: new Uint8Array() },
    });

    expect(response.status).toBe(400);
    expect(String((await body(response)).error)).toMatch(/no soportado/i);
    expect(harness.files).toEqual([]);
  });

  it('accepts a document and answers 201', async () => {
    const harness = makeHarness();

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: {
        name: 'presupuesto.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 2048,
        bytes: new Uint8Array([1]),
      },
    });

    expect(response.status).toBe(201);
    expect(harness.files).toHaveLength(1);
    expect((await body(response)).attachment).toBeDefined();
  });

  it('denies a peer with 403 and nothing stored', async () => {
    const harness = makeHarness({ user: { id: 'user-peer' } });

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: validFile,
    });

    expect(response.status).toBe(403);
    expect(harness.files).toEqual([]);
  });

  it('answers 404 for an unknown parent record', async () => {
    const harness = makeHarness({ recordOwner: null });

    const response = await handleUpload(harness.deps, {
      recordId: 'missing',
      file: validFile,
    });

    expect(response.status).toBe(404);
    expect(harness.files).toEqual([]);
  });

  it('requires both a file and a record id', async () => {
    const harness = makeHarness();

    const response = await handleUpload(harness.deps, {
      recordId: 'task-1',
      file: null,
    });

    expect(response.status).toBe(400);
    expect(harness.files).toEqual([]);
  });
});

describe('rejectOversizedBody (pre-parse size gate)', () => {
  it('answers the normal oversized message before the body is read', async () => {
    const response = rejectOversizedBody(String(MAX_ATTACHMENT_BYTES * 2));

    expect(response?.status).toBe(400);
    expect(String((await body(response as Response)).error)).toMatch(
      /demasiado grande/i,
    );
  });

  it('lets anything at or near the cap fall through to the same validation', () => {
    // Framing adds kilobytes, so a small overage cannot be judged from the
    // header alone — `validateAttachment` still owns the exact decision.
    expect(rejectOversizedBody(String(MAX_ATTACHMENT_BYTES + 1))).toBeNull();
    expect(rejectOversizedBody(String(MAX_ATTACHMENT_BYTES))).toBeNull();
  });

  it('stays silent when the header is absent or malformed', () => {
    expect(rejectOversizedBody(null)).toBeNull();
    expect(rejectOversizedBody('no-es-un-numero')).toBeNull();
    expect(rejectOversizedBody('1024')).toBeNull();
  });
});

describe('gateUploadRequest (identity and size are judged before the body)', () => {
  /** Reading this body throws, so a gate that parses first fails the test. */
  function poisonBody(): ReadableStream {
    return new ReadableStream({
      pull() {
        throw new Error('the body was read before the gates ran');
      },
    });
  }

  function poisonRequest(contentLength?: string): Request {
    return new Request('http://localhost/api/attachments/upload', {
      method: 'POST',
      ...(contentLength === undefined
        ? {}
        : { headers: { 'content-length': contentLength } }),
      body: poisonBody(),
      duplex: 'half',
    } as RequestInit);
  }

  it('answers 401 without a session and never reads the body', async () => {
    const response = gateUploadRequest(false, poisonRequest());

    expect(response?.status).toBe(401);
    expect(String((await body(response as Response)).error)).toMatch(/sesi/i);
  });

  it('rejects an oversized body before parsing, with or without a session', async () => {
    for (const hasSession of [true, false]) {
      const response = gateUploadRequest(
        hasSession,
        poisonRequest(String(MAX_ATTACHMENT_BYTES * 2)),
      );

      expect(response?.status).toBe(400);
      expect(String((await body(response as Response)).error)).toMatch(
        /demasiado grande/i,
      );
    }
  });

  it('lets a normal session through to the parser', () => {
    const request = new Request('http://localhost/api/attachments/upload', {
      method: 'POST',
      headers: { 'content-length': '1286' },
      body: 'payload',
    });
    expect(gateUploadRequest(true, request)).toBeNull();
    expect(gateUploadRequest(true, poisonRequest())).toBeNull();
  });

  it('only parses once both gates pass', async () => {
    const denied = await readGatedUploadBody(poisonRequest(), false);
    expect('response' in denied && denied.response.status).toBe(401);

    const oversized = await readGatedUploadBody(
      poisonRequest(String(MAX_ATTACHMENT_BYTES * 2)),
      true,
    );
    expect('response' in oversized && oversized.response.status).toBe(400);

    const parsed = await readGatedUploadBody(
      new Request('http://localhost/api/attachments/upload', {
        method: 'POST',
        body: new URLSearchParams({ recordId: 'rec-1' }),
      }),
      true,
    );
    expect('form' in parsed).toBe(true);
    expect('form' in parsed && parsed.form.get('recordId')).toBe('rec-1');
  });
});
