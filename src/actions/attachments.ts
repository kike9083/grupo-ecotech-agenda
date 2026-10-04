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
import { performDelete } from '@/lib/attachment-flow';

/**
 * Delete-attachment server action (PR6 task 6.5, spec `attachments` →
 * "Attachment deletion"): thin adapter over the tested `performDelete` flow —
 * resolves identity, wires the API-key data/storage access (design D3) and
 * revalidates the list so the gallery/player updates. The flow removes the
 * file first, then the metadata row.
 */
export async function deleteAttachmentAction(formData: FormData): Promise<void> {
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

  if (!result.ok && result.reason === 'session-expired') {
    redirect('/login?error=expired');
  }

  revalidatePath('/');
}
