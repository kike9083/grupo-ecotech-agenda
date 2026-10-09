'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Databases, Storage } from 'node-appwrite';
import { createAdminClient } from '@/lib/appwrite/clients';
import {
  ATTACHMENTS_BUCKET_ID,
  ATTACHMENTS_COLLECTION_ID,
  createAttachmentsApi,
} from '@/lib/appwrite/attachments';
import { getCurrentUser, isAdmin } from '@/lib/appwrite/session';
import { loadEnv } from '@/lib/env';
import {
  ATTACHMENT_FAILURE_MESSAGES,
  INITIAL_DELETE_ATTACHMENT_STATE,
  performDelete,
  type DeleteAttachmentState,
} from '@/lib/attachment-flow';

/**
 * Delete-attachment server action (PR6 task 6.5, spec `attachments` →
 * "Attachment deletion"): thin adapter over the tested `performDelete` flow —
 * resolves identity, wires the API-key data/storage access (design D3) and
 * revalidates the root layout so the gallery updates on `/` AND `/editar`.
 * The flow removes the file first, then the metadata row.
 *
 * Every outcome is now observable: success clears the banner, a missing row
 * is treated as already-deleted (so a double submit converges instead of
 * leaving a dead button), and any real failure comes back as
 * `DeleteAttachmentState` for an inline message. They used to resolve as
 * `void`, which made a failed "Eliminar" read as a silent no-op.
 */
export async function deleteAttachmentAction(
  _prevState: DeleteAttachmentState,
  formData: FormData,
): Promise<DeleteAttachmentState> {
  const documentId = String(formData.get('documentId') ?? '');

  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const admin = await isAdmin();
  const env = loadEnv();
  const client = createAdminClient();
  const api = createAttachmentsApi(new Databases(client), new Storage(client), {
    databaseId: env.APPWRITE_DATABASE_ID,
    bucketId: ATTACHMENTS_BUCKET_ID,
    collectionId: ATTACHMENTS_COLLECTION_ID,
  });

  const result = await performDelete(
    {
      getAttachment: (id) => api.getAttachment(id),
      deleteFile: (fileId) => api.deleteAttachmentFile(fileId),
      deleteDocument: (id) => api.deleteAttachmentDocument(id),
    },
    { documentId, ownerId: user.id, admin },
  );

  if (!result.ok) {
    if (result.reason === 'session-expired') {
      redirect('/login?error=expired');
    }
    // Already gone is success: the file the user wanted removed is gone.
    if (result.reason !== 'not-found') {
      return { formError: ATTACHMENT_FAILURE_MESSAGES[result.reason] };
    }
  }

  revalidatePath('/', 'layout');
  return INITIAL_DELETE_ATTACHMENT_STATE;
}
