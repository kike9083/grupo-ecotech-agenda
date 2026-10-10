/**
 * Idempotent, API-key provisioning for the agenda-notebook slice (PR1 design
 * D1 + PR5 design D3).
 *
 * Applies the additive `agenda.tasks` schema changes the notebook needs:
 *   1. `type` enum gains `note`                (probe A — updateEnumAttribute)
 *   2. `bodyHtml` string attribute (100000)    (rich-text body)
 *   3. `created_at` key index on `$createdAt`  (probe B — order undated notes)
 *
 * And the attachments storage (design D3):
 *   4. `agenda-attachments` bucket — fileSecurity, 30 MB, extension allow-list
 *   5. `attachments` collection — recordId/fileId/kind/name/mimeType/size/
 *      ownerId, `file_id` unique + `record_created` indexes, permissions that
 *      mirror `tasks` (collection `create("users")` + `read("team:admins")`,
 *      document `read/write("user:<owner>")`).
 *
 * Both enum probes are unverified on self-hosted Appwrite 1.8.1, so each has a
 * documented data-safe fallback (the collection is empty at apply time):
 *   - probe A fails → delete + recreate the enum attribute
 *   - probe B fails → add a `createdAt` ISO string attribute + index on it
 *
 * Re-running is a no-op: every step first reads current state and skips when
 * the change is already present. Existing documents are never touched.
 *
 * Usage: `node scripts/provision-notebook.ts`
 * Reads `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` /
 * `APPWRITE_DATABASE_ID` / `APPWRITE_TASKS_COLLECTION_ID` from `.env.local`.
 * The bucket/collection ids are fixed by design D3 (`agenda-attachments`,
 * `attachments`) — no extra env vars are required.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ProvisionEnv {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
  collectionId: string;
}

interface AttributeSummary {
  key: string;
  status?: string;
  elements?: string[];
}

interface IndexSummary {
  key: string;
  status?: string;
}

interface ApiResult {
  status: number;
  body: unknown;
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadProvisionEnv(): ProvisionEnv {
  const file = resolve(process.cwd(), '.env.local');
  const parsed = parseEnvFile(readFileSync(file, 'utf8'));

  const required = [
    'APPWRITE_ENDPOINT',
    'APPWRITE_PROJECT_ID',
    'APPWRITE_API_KEY',
    'APPWRITE_DATABASE_ID',
    'APPWRITE_TASKS_COLLECTION_ID',
  ] as const;

  const missing = required.filter((key) => !parsed[key]);
  if (missing.length > 0) {
    throw new Error(`Missing in .env.local: ${missing.join(', ')}`);
  }

  return {
    endpoint: parsed.APPWRITE_ENDPOINT.replace(/\/$/, ''),
    projectId: parsed.APPWRITE_PROJECT_ID,
    apiKey: parsed.APPWRITE_API_KEY,
    databaseId: parsed.APPWRITE_DATABASE_ID,
    collectionId: parsed.APPWRITE_TASKS_COLLECTION_ID,
  };
}

const env = loadProvisionEnv();

const baseUrl = `${env.endpoint}/databases/${env.databaseId}/collections/${env.collectionId}`;

/** Attachments resources are fixed by design D3 — no extra env vars. */
const ATTACHMENTS_BUCKET_ID = 'agenda-attachments';
const ATTACHMENTS_COLLECTION_ID = 'attachments';
/** Appwrite's 30 MB cap (decimal, matching the verified precedent buckets). */
const MAX_ATTACHMENT_BYTES = 30000000;
/**
 * Must equal `ALLOWED_ATTACHMENT_EXTENSIONS` in `src/lib/attachments.ts`
 * (images + audio + documents). Kept as a literal so this script stays free
 * of app imports; `attachments.test.ts` parses this file and fails if the two
 * lists ever drift — an older 12-entry copy here provisioned buckets that
 * rejected every pdf/doc the picker offered.
 */
const ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'webm',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'mp4',
  'aac',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
];

const storageBucketsUrl = `${env.endpoint}/storage/buckets`;
const attachmentsBaseUrl = `${env.endpoint}/databases/${env.databaseId}/collections/${ATTACHMENTS_COLLECTION_ID}`;

async function request(
  url: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<ApiResult> {
  const response = await fetch(url, {
    method,
    headers: {
      'X-Appwrite-Project': env.projectId,
      'X-Appwrite-Key': env.apiKey,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult> {
  return request(`${baseUrl}${path}`, method, body);
}

function describe(result: ApiResult): string {
  return `HTTP ${result.status} ${JSON.stringify(result.body)}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

async function getAttributes(): Promise<AttributeSummary[]> {
  const result = await api('GET', '/attributes');
  if (result.status !== 200) {
    throw new Error(`GET attributes failed: ${describe(result)}`);
  }
  const body = result.body as { attributes?: AttributeSummary[] };
  return body.attributes ?? [];
}

async function getIndexes(): Promise<IndexSummary[]> {
  const result = await api('GET', '/indexes');
  if (result.status !== 200) {
    throw new Error(`GET indexes failed: ${describe(result)}`);
  }
  const body = result.body as { indexes?: IndexSummary[] };
  return body.indexes ?? [];
}

async function waitForAttribute(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const attributes = await getAttributes();
    const attribute = attributes.find((entry) => entry.key === key);
    if (attribute === undefined) {
      throw new Error(`attribute ${key} disappeared while waiting`);
    }
    if (attribute.status === 'available') {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`attribute ${key} never reached "available"`);
}

async function waitForAttributeGone(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const attributes = await getAttributes();
    if (!attributes.some((entry) => entry.key === key)) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`attribute ${key} never finished deleting`);
}

async function waitForIndex(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const indexes = await getIndexes();
    const index = indexes.find((entry) => entry.key === key);
    if (index === undefined) {
      throw new Error(`index ${key} disappeared while waiting`);
    }
    if (index.status === 'available') {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`index ${key} never reached "available"`);
}

interface CollectionAttributeSummary {
  key: string;
  status?: string;
  elements?: string[];
}

interface CollectionIndexSummary {
  key: string;
  status?: string;
}

async function getAttachmentsAttributes(): Promise<CollectionAttributeSummary[]> {
  const result = await request(`${attachmentsBaseUrl}/attributes`, 'GET');
  if (result.status !== 200) {
    throw new Error(`GET attachments attributes failed: ${describe(result)}`);
  }
  const body = result.body as { attributes?: CollectionAttributeSummary[] };
  return body.attributes ?? [];
}

async function getAttachmentsIndexes(): Promise<CollectionIndexSummary[]> {
  const result = await request(`${attachmentsBaseUrl}/indexes`, 'GET');
  if (result.status !== 200) {
    throw new Error(`GET attachments indexes failed: ${describe(result)}`);
  }
  const body = result.body as { indexes?: CollectionIndexSummary[] };
  return body.indexes ?? [];
}

async function waitForAttachmentsAttribute(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const attributes = await getAttachmentsAttributes();
    const attribute = attributes.find((entry) => entry.key === key);
    if (attribute === undefined) {
      throw new Error(`attachments attribute ${key} disappeared while waiting`);
    }
    if (attribute.status === 'available') {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`attachments attribute ${key} never reached "available"`);
}

async function waitForAttachmentsIndex(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const indexes = await getAttachmentsIndexes();
    const index = indexes.find((entry) => entry.key === key);
    if (index === undefined) {
      throw new Error(`attachments index ${key} disappeared while waiting`);
    }
    if (index.status === 'available') {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`attachments index ${key} never reached "available"`);
}

interface StepOutcome {
  step: string;
  changed: boolean;
  fallback: boolean;
  detail: string;
}

async function createTypeEnum(): Promise<ApiResult> {
  const created = await api('POST', '/attributes/enum', {
    key: 'type',
    elements: ['task', 'request', 'note'],
    required: true,
  });
  if (created.status !== 202 && created.status !== 201) {
    throw new Error(`enum recreate fallback failed: ${describe(created)}`);
  }
  await waitForAttribute('type');
  return created;
}

/** Probe A: add `note` to the `type` enum via updateEnumAttribute. */
async function ensureNoteEnum(): Promise<StepOutcome> {
  const attributes = await getAttributes();
  const typeAttribute = attributes.find((entry) => entry.key === 'type');

  if (typeAttribute?.elements?.includes('note') === true) {
    return {
      step: 'enum.type',
      changed: false,
      fallback: false,
      detail: 'note already present — skipped',
    };
  }

  // A previous fallback may have deleted the attribute without recreating it
  // (Appwrite keeps it in `deleting` state for a moment) — finish that here.
  if (typeAttribute === undefined) {
    const created = await createTypeEnum();
    return {
      step: 'enum.type',
      changed: true,
      fallback: true,
      detail: `fallback create (attribute was missing) OK (${describe(created)})`,
    };
  }

  const updated = await api('PATCH', '/attributes/enum/type', {
    elements: ['task', 'request', 'note'],
    required: true,
  });

  if (updated.status === 200 || updated.status === 202) {
    await waitForAttribute('type');
    return {
      step: 'enum.type',
      changed: true,
      fallback: false,
      detail: `updateEnumAttribute OK (${describe(updated)})`,
    };
  }

  console.warn(`[probe A] updateEnumAttribute failed: ${describe(updated)}`);
  console.warn('[probe A] applying data-safe fallback: delete + recreate enum');

  const deleted = await api('DELETE', '/attributes/type');
  if (deleted.status !== 204 && deleted.status !== 200) {
    throw new Error(`enum delete fallback failed: ${describe(deleted)}`);
  }
  await waitForAttributeGone('type');

  const created = await createTypeEnum();

  return {
    step: 'enum.type',
    changed: true,
    fallback: true,
    detail: `fallback delete+recreate OK (${describe(created)})`,
  };
}

/** `bodyHtml` rich-text body (design D1, size 100000, optional). */
async function ensureBodyHtml(): Promise<StepOutcome> {
  const attributes = await getAttributes();
  if (attributes.some((entry) => entry.key === 'bodyHtml')) {
    return {
      step: 'attribute.bodyHtml',
      changed: false,
      fallback: false,
      detail: 'bodyHtml already present — skipped',
    };
  }

  const created = await api('POST', '/attributes/string', {
    key: 'bodyHtml',
    size: 100000,
    required: false,
  });
  if (created.status !== 202 && created.status !== 201) {
    throw new Error(`bodyHtml create failed: ${describe(created)}`);
  }
  await waitForAttribute('bodyHtml');

  return {
    step: 'attribute.bodyHtml',
    changed: true,
    fallback: false,
    detail: `createStringAttribute OK (${describe(created)})`,
  };
}

/** Probe B: key index on `$createdAt` so undated notes order by creation. */
async function ensureCreatedAtIndex(): Promise<StepOutcome> {
  const indexes = await getIndexes();
  if (indexes.some((entry) => entry.key === 'created_at')) {
    return {
      step: 'index.created_at',
      changed: false,
      fallback: false,
      detail: 'created_at already present — skipped',
    };
  }

  const created = await api('POST', '/indexes', {
    key: 'created_at',
    type: 'key',
    attributes: ['$createdAt'],
    orders: ['desc'],
  });

  if (created.status === 202 || created.status === 201) {
    await waitForIndex('created_at');
    return {
      step: 'index.created_at',
      changed: true,
      fallback: false,
      detail: `createIndex on $createdAt OK (${describe(created)})`,
    };
  }

  console.warn(`[probe B] createIndex on $createdAt failed: ${describe(created)}`);
  console.warn('[probe B] applying data-safe fallback: createdAt string attr + index');

  const attribute = await api('POST', '/attributes/string', {
    key: 'createdAt',
    size: 30,
    required: false,
  });
  if (attribute.status !== 202 && attribute.status !== 201) {
    throw new Error(`createdAt attribute fallback failed: ${describe(attribute)}`);
  }
  await waitForAttribute('createdAt');

  const fallbackIndex = await api('POST', '/indexes', {
    key: 'created_at',
    type: 'key',
    attributes: ['createdAt'],
    orders: ['desc'],
  });
  if (fallbackIndex.status !== 202 && fallbackIndex.status !== 201) {
    throw new Error(`createdAt index fallback failed: ${describe(fallbackIndex)}`);
  }
  await waitForIndex('created_at');

  return {
    step: 'index.created_at',
    changed: true,
    fallback: true,
    detail: `fallback createdAt attr + index OK (${describe(fallbackIndex)})`,
  };
}

/** Bucket `agenda-attachments` (design D3): fileSecurity, 30 MB, extension allow-list. */
async function ensureAttachmentsBucket(): Promise<StepOutcome> {
  const existing = await request(
    `${storageBucketsUrl}/${ATTACHMENTS_BUCKET_ID}`,
    'GET',
  );
  if (existing.status === 200) {
    const bucket = (
      existing.body as { bucket?: Record<string, unknown> }
    ).bucket ?? (existing.body as Record<string, unknown>);

    const currentExtensions = Array.isArray(bucket.allowedFileExtensions)
      ? (bucket.allowedFileExtensions as string[])
      : [];
    const inSync =
      bucket.maximumFileSize === MAX_ATTACHMENT_BYTES &&
      currentExtensions.length === ALLOWED_EXTENSIONS.length &&
      ALLOWED_EXTENSIONS.every((entry) => currentExtensions.includes(entry));

    if (inSync) {
      return {
        step: 'bucket.agenda-attachments',
        changed: false,
        fallback: false,
        detail: 'bucket already present and in sync — skipped',
      };
    }

    // An existing bucket still carries the old 12-extension allow-list, so
    // `.pdf` would 404 at storage level even though the validator says yes.
    const updated = await request(
      `${storageBucketsUrl}/${ATTACHMENTS_BUCKET_ID}`,
      'PUT',
      {
        name: typeof bucket.name === 'string' ? bucket.name : 'Agenda attachments',
        permissions: Array.isArray(bucket.permissions) ? bucket.permissions : [],
        fileSecurity: bucket.fileSecurity === true,
        enabled: bucket.enabled !== false,
        maximumFileSize: MAX_ATTACHMENT_BYTES,
        allowedFileExtensions: ALLOWED_EXTENSIONS,
      },
    );
    if (updated.status !== 200 && updated.status !== 202) {
      throw new Error(`updateBucket failed: ${describe(updated)}`);
    }

    return {
      step: 'bucket.agenda-attachments',
      changed: true,
      fallback: false,
      detail: `updateBucket OK — extensions ${currentExtensions.length} → ${ALLOWED_EXTENSIONS.length} (${describe(updated)})`,
    };
  }
  if (existing.status !== 404) {
    throw new Error(`GET attachments bucket failed: ${describe(existing)}`);
  }

  const created = await request(storageBucketsUrl, 'POST', {
    bucketId: ATTACHMENTS_BUCKET_ID,
    name: 'Agenda attachments',
    fileSecurity: true,
    enabled: true,
    maximumFileSize: MAX_ATTACHMENT_BYTES,
    allowedFileExtensions: ALLOWED_EXTENSIONS,
    permissions: [],
  });
  if (created.status !== 201 && created.status !== 202) {
    throw new Error(`createBucket failed: ${describe(created)}`);
  }

  return {
    step: 'bucket.agenda-attachments',
    changed: true,
    fallback: false,
    detail: `createBucket OK (${describe(created)})`,
  };
}

async function ensureAttachmentAttribute(
  key: string,
  body: Record<string, unknown>,
  path: string,
): Promise<'created' | 'updated' | 'unchanged' | 'failed'> {
  const attributes = await getAttachmentsAttributes();
  const existing = attributes.find((entry) => entry.key === key);

  if (existing !== undefined) {
    // Enum drift: `kind` was first provisioned as ['image','audio'], so a
    // freshly created collection rejected every pdf/doc/xls the picker offers.
    // Comparing (instead of skipping) is what repairs it — a fresh bucket and
    // a fresh collection must converge on the same shape every run.
    if (path !== '/attributes/enum' || !Array.isArray(existing.elements)) {
      return 'unchanged';
    }
    const wanted = body.elements as string[];
    const missing = wanted.filter((value) => !existing.elements?.includes(value));
    if (missing.length === 0) {
      return 'unchanged';
    }

    // Appwrite 1.8.1 validates `default` as mandatory on this route even
    // though `kind` is required and carries none — verified live: the payload
    // the first draft sent answers 400 `Param "default" is not optional.`,
    // while the same payload plus `default` passes route validation. Try null
    // first so nothing gains a default, then the first element.
    //
    // Never throw from here: a failed reconcile must not abort the run and
    // hide every attribute and index that follows it (and unlike the note
    // collection, deleting `kind` would wipe the value on every attachment).
    let updated: ApiResult | null = null;
    for (const payload of [
      { elements: wanted, required: body.required === true, default: null },
      { elements: wanted, required: body.required === true, default: wanted[0] },
    ]) {
      updated = await request(`${attachmentsBaseUrl}${path}/${key}`, 'PATCH', payload);
      if (updated.status === 200 || updated.status === 202) {
        break;
      }
    }

    if (updated === null || (updated.status !== 200 && updated.status !== 202)) {
      console.warn(
        `[provision] could not reconcile enum ${key}: ${updated === null ? 'no response' : describe(updated)}`,
      );
      return 'failed';
    }

    await waitForAttachmentsAttribute(key);
    return 'updated';
  }

  const created = await request(`${attachmentsBaseUrl}${path}`, 'POST', body);
  if (created.status !== 201 && created.status !== 202) {
    throw new Error(`create ${key} attribute failed: ${describe(created)}`);
  }
  await waitForAttachmentsAttribute(key);
  return 'created';
}

/**
 * Collection `attachments` (design D3): permissions mirror `tasks` — any
 * authenticated user may create a document, only the `admins` team reads
 * everything at collection level, and each document grants its owner
 * read/write. `documentSecurity:true` enables those per-document grants.
 */
async function ensureAttachmentsCollection(): Promise<StepOutcome> {
  const existing = await request(attachmentsBaseUrl, 'GET');
  let createdCollection = false;

  if (existing.status === 404) {
    const created = await request(
      `${env.endpoint}/databases/${env.databaseId}/collections`,
      'POST',
      {
        collectionId: ATTACHMENTS_COLLECTION_ID,
        name: 'Attachments',
        permissions: ['create("users")', 'read("team:admins")'],
        documentSecurity: true,
        enabled: true,
      },
    );
    if (created.status !== 201 && created.status !== 202) {
      throw new Error(`createCollection failed: ${describe(created)}`);
    }
    createdCollection = true;
  } else if (existing.status !== 200) {
    throw new Error(`GET attachments collection failed: ${describe(existing)}`);
  }

  const changes: string[] = [];

  const attributes: Array<[string, Record<string, unknown>, string]> = [
    ['recordId', { key: 'recordId', size: 36, required: true }, '/attributes/string'],
    ['fileId', { key: 'fileId', size: 36, required: true }, '/attributes/string'],
    ['kind', { key: 'kind', elements: ['image', 'audio', 'document'], required: true }, '/attributes/enum'],
    ['name', { key: 'name', size: 255, required: true }, '/attributes/string'],
    ['mimeType', { key: 'mimeType', size: 100, required: true }, '/attributes/string'],
    ['size', { key: 'size', required: true, min: 0, max: MAX_ATTACHMENT_BYTES }, '/attributes/integer'],
    ['ownerId', { key: 'ownerId', size: 36, required: true }, '/attributes/string'],
  ];

  const failed: string[] = [];

  for (const [key, body, path] of attributes) {
    const result = await ensureAttachmentAttribute(key, body, path);
    if (result === 'failed') {
      failed.push(key);
    } else if (result !== 'unchanged') {
      changes.push(`attr:${key}`);
    }
  }

  const indexes: Array<[string, Record<string, unknown>]> = [
    ['file_id', { key: 'file_id', type: 'unique', attributes: ['fileId'], orders: ['asc'] }],
    [
      'record_created',
      {
        key: 'record_created',
        type: 'key',
        attributes: ['recordId', '$createdAt'],
        orders: ['asc', 'asc'],
      },
    ],
  ];

  for (const [key, body] of indexes) {
    const existingIndexes = await getAttachmentsIndexes();
    if (existingIndexes.some((entry) => entry.key === key)) {
      continue;
    }
    const created = await request(`${attachmentsBaseUrl}/indexes`, 'POST', body);
    if (created.status !== 201 && created.status !== 202) {
      throw new Error(`create ${key} index failed: ${describe(created)}`);
    }
    await waitForAttachmentsIndex(key);
    changes.push(`index:${key}`);
  }

  return {
    step: 'collection.attachments',
    changed: changes.length > 0 || createdCollection,
    fallback: failed.length > 0,
    detail:
      failed.length > 0
        ? `could not reconcile ${failed.join(', ')} — remaining attributes and indexes were still ensured`
        : changes.length > 0
          ? `applied ${changes.join(', ')}`
          : 'attachments schema already present — skipped',
  };
}

async function main(): Promise<void> {
  console.log(`Provisioning notebook schema on ${env.databaseId}.${env.collectionId}`);
  const outcomes: StepOutcome[] = [];

  outcomes.push(await ensureNoteEnum());
  outcomes.push(await ensureBodyHtml());
  outcomes.push(await ensureCreatedAtIndex());
  outcomes.push(await ensureAttachmentsBucket());
  outcomes.push(await ensureAttachmentsCollection());

  console.log('\nProvisioning summary:');
  for (const outcome of outcomes) {
    const marker = outcome.fallback ? 'FALLBACK' : outcome.changed ? 'APPLIED' : 'SKIP';
    console.log(`  [${marker}] ${outcome.step} — ${outcome.detail}`);
  }

  const usedFallback = outcomes.some((outcome) => outcome.fallback);
  console.log(`\nDone. Fallbacks used: ${usedFallback ? 'yes' : 'no'}`);
}

main().catch((error: unknown) => {
  console.error('Provisioning failed:', error);
  process.exitCode = 1;
});
