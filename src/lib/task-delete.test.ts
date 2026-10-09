import { describe, expect, it } from 'vitest';
import { DomainError } from '@/lib/appwrite/errors';
import { SESSION_EXPIRED_REDIRECT } from '@/lib/task-creation';
import {
  DELETE_ERROR_MESSAGES,
  DELETE_LOCAL_ERROR_MESSAGES,
  DELETE_SUCCESS_REDIRECT,
  performDeleteTask,
  type DeleteAttachmentRef,
  type DeleteTaskDeps,
  type DeleteTaskState,
} from '@/lib/task-delete';

const owner = 'user-owner';
const recordId = 'doc-9';

interface Harness {
  deps: DeleteTaskDeps;
  /** Ordered trace — asserts the cascade, not just that it happened. */
  calls: string[];
  invalid: DeleteTaskState[];
  redirects: string[];
}

interface HarnessOptions {
  ownerId?: string;
  admin?: boolean;
  attachments?: DeleteAttachmentRef[];
  listError?: unknown;
  /** Returns the failure to raise for that file id, or undefined to succeed. */
  fileError?(fileId: string): unknown;
  /** Returns the failure to raise for that row id, or undefined to succeed. */
  rowError?(documentId: string): unknown;
  deleteTaskError?: unknown;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const harness: Harness = {
    calls: [],
    invalid: [],
    redirects: [],
    deps: {
      ownerId: options.ownerId ?? owner,
      admin: options.admin ?? false,
      listAttachments: async (id) => {
        harness.calls.push(`list:${id}`);
        if (options.listError !== undefined) {
          throw options.listError;
        }
        return options.attachments ?? [];
      },
      deleteFile: async (fileId) => {
        harness.calls.push(`file:${fileId}`);
        const failure = options.fileError?.(fileId);
        if (failure !== undefined) {
          throw failure;
        }
      },
      deleteAttachmentDocument: async (documentId) => {
        harness.calls.push(`row:${documentId}`);
        const failure = options.rowError?.(documentId);
        if (failure !== undefined) {
          throw failure;
        }
      },
      deleteTask: async (id) => {
        harness.calls.push(`task:${id}`);
        if (options.deleteTaskError !== undefined) {
          throw options.deleteTaskError;
        }
      },
      onInvalid: (state) => {
        harness.invalid.push(state);
      },
      redirect: (to) => {
        harness.redirects.push(to);
      },
    },
  };
  return harness;
}

const attachments: DeleteAttachmentRef[] = [
  { documentId: 'att-1', fileId: 'file-1' },
  { documentId: 'att-2', fileId: 'file-2' },
];

const owned = { documentId: recordId, createdBy: owner };

describe('performDeleteTask (spec → Delete record)', () => {
  it('refuses without a document id and touches nothing', async () => {
    const harness = makeHarness();

    await performDeleteTask(harness.deps, {
      documentId: '',
      createdBy: owner,
    });

    expect(harness.invalid).toEqual([
      { formError: DELETE_LOCAL_ERROR_MESSAGES.missingId },
    ]);
    expect(harness.calls).toEqual([]);
    expect(harness.redirects).toEqual([]);
  });

  it('refuses a non-owner without the admin flag and touches nothing', async () => {
    const harness = makeHarness({ admin: false });

    await performDeleteTask(harness.deps, {
      documentId: recordId,
      createdBy: 'someone-else',
    });

    expect(harness.invalid).toEqual([
      { formError: DELETE_LOCAL_ERROR_MESSAGES.forbidden },
    ]);
    expect(harness.calls).toEqual([]);
    expect(harness.redirects).toEqual([]);
  });

  it("lets an admin remove somebody else's record", async () => {
    const harness = makeHarness({ admin: true });

    await performDeleteTask(harness.deps, {
      documentId: recordId,
      createdBy: 'someone-else',
    });

    expect(harness.invalid).toEqual([]);
    expect(harness.redirects).toEqual([DELETE_SUCCESS_REDIRECT]);
    expect(harness.calls).toEqual([`list:${recordId}`, `task:${recordId}`]);
  });

  it('removes every attachment — file then row — before the record', async () => {
    const harness = makeHarness({ attachments });

    await performDeleteTask(harness.deps, owned);

    expect(harness.calls).toEqual([
      `list:${recordId}`,
      'file:file-1',
      'row:att-1',
      'file:file-2',
      'row:att-2',
      `task:${recordId}`,
    ]);
    expect(harness.redirects).toEqual([DELETE_SUCCESS_REDIRECT]);
  });

  it('keeps the record when an attachment cannot be removed', async () => {
    const harness = makeHarness({
      attachments,
      fileError: (fileId) =>
        fileId === 'file-2' ? { code: 500, message: 'boom' } : undefined,
    });

    await performDeleteTask(harness.deps, owned);

    expect(harness.invalid).toEqual([
      { formError: DELETE_LOCAL_ERROR_MESSAGES.attachments },
    ]);
    // Stops before `task`, so a retry finishes the cascade without orphans.
    expect(harness.calls).toEqual([
      `list:${recordId}`,
      'file:file-1',
      'row:att-1',
      'file:file-2',
    ]);
    expect(harness.redirects).toEqual([]);
  });

  it('tolerates an already-gone file or row so a retry cannot stall', async () => {
    const goneFile = makeHarness({
      attachments: [attachments[0]],
      fileError: (fileId) =>
        fileId === 'file-1' ? { code: 404, message: 'gone' } : undefined,
    });
    const goneRow = makeHarness({
      attachments: [attachments[0]],
      rowError: (documentId) =>
        documentId === 'att-1' ? { code: 404, message: 'gone' } : undefined,
    });

    await performDeleteTask(goneFile.deps, owned);
    await performDeleteTask(goneRow.deps, owned);

    for (const harness of [goneFile, goneRow]) {
      expect(harness.invalid).toEqual([]);
      expect(harness.redirects).toEqual([DELETE_SUCCESS_REDIRECT]);
      expect(harness.calls).toEqual([
        `list:${recordId}`,
        'file:file-1',
        'row:att-1',
        `task:${recordId}`,
      ]);
    }
  });

  it('surfaces the domain copy when the record itself cannot be deleted', async () => {
    const harness = makeHarness({
      deleteTaskError: { code: 403, message: 'forbidden' },
    });

    await performDeleteTask(harness.deps, owned);

    expect(harness.invalid).toEqual([
      { formError: DELETE_ERROR_MESSAGES.unauthorized },
    ]);
    expect(harness.redirects).toEqual([]);
  });

  it('bounces to login when the session expired', async () => {
    const harness = makeHarness({
      deleteTaskError: new DomainError('session-expired', 'session stale'),
    });

    await performDeleteTask(harness.deps, owned);

    expect(harness.redirects).toEqual([SESSION_EXPIRED_REDIRECT]);
    expect(harness.invalid).toEqual([]);
  });
});
