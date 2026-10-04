/**
 * Idempotent, API-key provisioning for the agenda-notebook slice (PR1, design D1).
 *
 * Applies the additive `agenda.tasks` schema changes the notebook needs:
 *   1. `type` enum gains `note`                (probe A — updateEnumAttribute)
 *   2. `bodyHtml` string attribute (100000)    (rich-text body)
 *   3. `created_at` key index on `$createdAt`  (probe B — order undated notes)
 *
 * Both probes are unverified on self-hosted Appwrite 1.8.1, so each has a
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

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
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

async function main(): Promise<void> {
  console.log(`Provisioning notebook schema on ${env.databaseId}.${env.collectionId}`);
  const outcomes: StepOutcome[] = [];

  outcomes.push(await ensureNoteEnum());
  outcomes.push(await ensureBodyHtml());
  outcomes.push(await ensureCreatedAtIndex());

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
