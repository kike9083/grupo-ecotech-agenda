import { Databases, Storage } from 'node-appwrite';
import {
  createAdminClient,
  createSessionClient,
} from '@/lib/appwrite/clients';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
  type Attachment,
} from '@/lib/appwrite/attachments';
import { getCurrentUser, getSessionSecret } from '@/lib/appwrite/session';
import { loadEnv } from '@/lib/env';
import { performRead } from '@/lib/attachment-flow';

/**
 * Authorized attachment proxy (PR7 task 7.2, design D3): the browser only ever
 * requests `/api/attachments/<fileId>`. The session client looks the file up
 * (Appwrite enforces the document read permission, so a peer gets 404), then
 * the API-key client streams the bytes with the stored MIME type. No Appwrite
 * URL or storage token is ever exposed to the browser.
 */

export interface ReadRouteDeps {
  getSessionUser(): Promise<{ id: string } | null>;
  getAttachmentByFileId(fileId: string): Promise<Attachment | null>;
  readFile(fileId: string): Promise<ArrayBuffer>;
}

/** Pure route core: runs the tested `performRead` and maps it to a Response. */
export async function handleRead(
  deps: ReadRouteDeps,
  fileId: string,
): Promise<Response> {
  const user = await deps.getSessionUser();
  const result = await performRead(
    {
      getSessionUserId: async () => (user === null ? null : user.id),
      getAttachmentByFileId: deps.getAttachmentByFileId,
      readFile: deps.readFile,
    },
    fileId,
  );

  if (result.status === 200) {
    return new Response(result.bytes, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return new Response(result.message, { status: result.status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await params;

  const user = await getCurrentUser();
  const secret = await getSessionSecret();
  const env = loadEnv();

  const sessionDatabases = new Databases(createSessionClient(secret ?? ''));
  const adminStorage = new Storage(createAdminClient());
  const api = createAttachmentsApi(sessionDatabases, adminStorage, {
    databaseId: env.APPWRITE_DATABASE_ID,
    bucketId: ATTACHMENTS_BUCKET_ID,
    collectionId: ATTACHMENTS_COLLECTION_ID,
  });

  return handleRead(
    {
      getSessionUser: async () =>
        user === null || secret === null ? null : { id: user.id },
      getAttachmentByFileId: (id) => api.getAttachmentByFileId(id),
      readFile: (id) => api.readAttachmentFile(id),
    },
    fileId,
  );
}
