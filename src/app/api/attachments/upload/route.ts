import { Databases, Storage } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import {
  createAdminClient,
  createSessionClient,
} from '@/lib/appwrite/clients';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
} from '@/lib/appwrite/attachments';
import { toDomainError } from '@/lib/appwrite/errors';
import { getCurrentUser, getSessionSecret, isAdmin } from '@/lib/appwrite/session';
import { loadEnv } from '@/lib/env';
import {
  ATTACHMENT_FAILURE_MESSAGES,
  attachmentFailureStatus,
  performUpload,
  type UploadFileInput,
  type UploadResult,
} from '@/lib/attachment-flow';

/**
 * Upload route (PR6 task 6.3, design D3): the ONLY upload path — a multipart
 * route handler, never a Server Action, because Next caps action bodies at
 * 1 MB while attachments may reach 30 MB. The handler resolves the session,
 * delegates authz/validation/rollback to the tested `performUpload` flow, and
 * maps the outcome to HTTP + Spanish copy. The browser never talks to Appwrite.
 */

export interface UploadRouteDeps {
  getSessionUser(): Promise<{ id: string } | null>;
  isAdmin(): Promise<boolean>;
  performUpload(input: {
    recordId: string;
    ownerId: string;
    admin: boolean;
    file: UploadFileInput;
  }): Promise<UploadResult>;
}

export interface UploadRequestInput {
  recordId: string;
  file: UploadFileInput | null;
}

function json(data: Record<string, unknown>, status: number): Response {
  return Response.json(data, { status });
}

/**
 * Pure route core: session gate, required-field gate, then the flow. Kept
 * separate from the `POST` adapter so it runs in the node test environment.
 */
export async function handleUpload(
  deps: UploadRouteDeps,
  input: UploadRequestInput,
): Promise<Response> {
  const user = await deps.getSessionUser();
  if (user === null) {
    return json({ error: ATTACHMENT_FAILURE_MESSAGES['session-expired'] }, 401);
  }

  if (input.file === null || input.recordId === '') {
    return json({ error: 'Falta el archivo o el registro.' }, 400);
  }

  const admin = await deps.isAdmin();
  const result = await deps.performUpload({
    recordId: input.recordId,
    ownerId: user.id,
    admin,
    file: input.file,
  });

  if (result.ok) {
    return json({ attachment: result.attachment }, 201);
  }
  return json(
    { error: ATTACHMENT_FAILURE_MESSAGES[result.reason] },
    attachmentFailureStatus(result.reason),
  );
}

async function readFileEntry(entry: FormDataEntryValue | null): Promise<UploadFileInput | null> {
  if (!(entry instanceof File)) {
    return null;
  }
  return {
    name: entry.name,
    type: entry.type,
    size: entry.size,
    bytes: new Uint8Array(await entry.arrayBuffer()),
  };
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = await readFileEntry(form.get('file'));
  const recordId = String(form.get('recordId') ?? '');

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  const env = loadEnv();

  return handleUpload(
    {
      getSessionUser: async () =>
        user === null || secret === null ? null : { id: user.id },
      isAdmin: () => isAdmin(),
      performUpload: async (input) => {
        // Reads run through the session client (Appwrite enforces the parent
        // record's read permission); writes use the API key after app-level
        // authorization (design D3) so an admin can mirror someone else's owner.
        const sessionDatabases = new Databases(createSessionClient(secret ?? ''));
        const adminDatabases = new Databases(createAdminClient());
        const adminStorage = new Storage(createAdminClient());
        const api = createAttachmentsApi(adminDatabases, adminStorage, {
          databaseId: env.APPWRITE_DATABASE_ID,
          bucketId: ATTACHMENTS_BUCKET_ID,
          collectionId: ATTACHMENTS_COLLECTION_ID,
        });

        return performUpload(
          {
            getRecordOwner: async (recordId) => {
              try {
                const doc = await sessionDatabases.getDocument(
                  env.APPWRITE_DATABASE_ID,
                  env.APPWRITE_TASKS_COLLECTION_ID,
                  recordId,
                );
                return typeof doc.createdBy === 'string' ? doc.createdBy : null;
              } catch (error) {
                const domain = toDomainError(error);
                if (
                  domain.kind === 'not-found' ||
                  domain.kind === 'unauthorized'
                ) {
                  return null;
                }
                throw domain;
              }
            },
            createFile: async ({ name, bytes, ownerId }) =>
              api.createAttachmentFile(
                InputFile.fromBuffer(Buffer.from(bytes), name),
                ownerId,
              ),
            createDocument: (record) => api.createAttachment(record),
            deleteFile: (fileId) => api.deleteAttachmentFile(fileId),
          },
          input,
        );
      },
    },
    { recordId, file },
  );
}
