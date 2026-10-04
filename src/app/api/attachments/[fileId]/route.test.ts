import { describe, expect, it } from 'vitest';
import type { Attachment } from '@/lib/appwrite/attachments';
import { handleRead, type ReadRouteDeps } from './route';

/**
 * RED seam for PR7 task 7.1 (spec `attachments` → "Attachment visibility" /
 * "Attachment display"): the proxy answers 401 without a session, 404 when the
 * session cannot see the file (peer isolation), and 200 with the stored MIME
 * when it can. The browser only ever sees `/api/attachments/<fileId>`.
 */

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    $id: 'att-1',
    $createdAt: '2026-10-04T10:00:00.000+00:00',
    recordId: 'task-1',
    fileId: 'file-1',
    kind: 'image',
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    size: 3,
    ownerId: 'user-owner',
    ...overrides,
  };
}

interface Harness {
  deps: ReadRouteDeps;
  readCalls: string[];
}

function makeHarness(options: {
  user?: { id: string } | null;
  found?: Attachment | null;
} = {}): Harness {
  const readCalls: string[] = [];
  const deps: ReadRouteDeps = {
    getSessionUser: async () =>
      options.user === undefined ? { id: 'user-owner' } : options.user,
    getAttachmentByFileId: async () =>
      options.found === undefined ? attachment() : options.found,
    readFile: async (fileId) => {
      readCalls.push(fileId);
      return new Uint8Array([1, 2, 3]).buffer;
    },
  };
  return { deps, readCalls };
}

describe('handleRead (spec attachments → Attachment display)', () => {
  it('returns 401 without a session and never reads bytes', async () => {
    const harness = makeHarness({ user: null });

    const response = await handleRead(harness.deps, 'file-1');

    expect(response.status).toBe(401);
    expect(harness.readCalls).toEqual([]);
  });

  it('returns 404 for a file the session cannot see (spec → Peer isolation)', async () => {
    const harness = makeHarness({ found: null });

    const response = await handleRead(harness.deps, 'someone-elses-file');

    expect(response.status).toBe(404);
    expect(harness.readCalls).toEqual([]);
  });

  it('streams the bytes with the stored MIME type', async () => {
    const harness = makeHarness();

    const response = await handleRead(harness.deps, 'file-1');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(harness.readCalls).toEqual(['file-1']);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('serves an audio attachment with its own MIME type', async () => {
    const harness = makeHarness({
      found: attachment({ kind: 'audio', mimeType: 'audio/webm', name: 'nota.webm' }),
    });

    const response = await handleRead(harness.deps, 'file-1');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/webm');
  });
});
