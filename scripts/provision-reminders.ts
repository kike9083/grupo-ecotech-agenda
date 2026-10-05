/**
 * Idempotent, API-key provisioning for the agenda-reminders slice (design D7).
 *
 * Applies ONLY additive schema to the `agenda` database:
 *   1. collection `telegram_subscriptions` — permissions mirror `tasks`
 *      (collection `create("users") + read("team:admins")`, `documentSecurity`
 *      on so each document grants `read/write("user:<uid>")`), plus
 *   2. five attributes: `userId` (string 36, required), `chatId` (40),
 *      `active` (boolean), `token` (64), `tokenExpiresAt` (30) — the four
 *      optional ones default to the "unlinked" empty state, and
 *   3. two indexes: `user_id` UNIQUE(`userId`) — one doc per user, and
 *      `token` KEY(`token`) — the exchange lookup (never filters on `''`).
 *   4. probe: `agenda.tasks` + `notified` boolean `required:false,
 *      default:false`. Appwrite 1.8.1 support for `default` on attribute
 *      create is UNVERIFIED (design D7): a rejection retries WITHOUT
 *      `default`, because the read path treats anything `!== true` as
 *      unnotified — so a `null`-backfilled legacy row is correct by
 *      construction. No data backfill, no new index, no document write.
 *
 * Re-running is a no-op: every step reads current state first and skips when
 * the change already exists. This script NEVER deletes or updates anything —
 * existing documents (including the real `tasks` rows) are untouched, and
 * `crm-ge` / `ecotech_sitio_web` are never addressed (only the `agenda`
 * database from `APPWRITE_DATABASE_ID`).
 *
 * Usage: `node scripts/provision-reminders.ts`
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
  tasksCollectionId: string;
}

interface AttributeSummary {
  key: string;
  status?: string;
  default?: unknown;
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
    tasksCollectionId: parsed.APPWRITE_TASKS_COLLECTION_ID,
  };
}

const env = loadProvisionEnv();

/** Design D7 — fixed ids, no extra env vars. */
const SUBSCRIPTIONS_COLLECTION_ID = 'telegram_subscriptions';

const collectionsUrl = `${env.endpoint}/databases/${env.databaseId}/collections`;
const subscriptionsBaseUrl = `${collectionsUrl}/${SUBSCRIPTIONS_COLLECTION_ID}`;
const tasksBaseUrl = `${collectionsUrl}/${env.tasksCollectionId}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

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

function describe(result: ApiResult): string {
  return `HTTP ${result.status} ${JSON.stringify(result.body)}`;
}

async function getSubscriptionAttributes(): Promise<AttributeSummary[]> {
  const result = await request(`${subscriptionsBaseUrl}/attributes`, 'GET');
  if (result.status !== 200) {
    throw new Error(`GET attributes failed: ${describe(result)}`);
  }
  const body = result.body as { attributes?: AttributeSummary[] };
  return body.attributes ?? [];
}

async function getSubscriptionIndexes(): Promise<IndexSummary[]> {
  const result = await request(`${subscriptionsBaseUrl}/indexes`, 'GET');
  if (result.status !== 200) {
    throw new Error(`GET indexes failed: ${describe(result)}`);
  }
  const body = result.body as { indexes?: IndexSummary[] };
  return body.indexes ?? [];
}

async function getTasksAttributes(): Promise<AttributeSummary[]> {
  const result = await request(`${tasksBaseUrl}/attributes`, 'GET');
  if (result.status !== 200) {
    throw new Error(`GET tasks attributes failed: ${describe(result)}`);
  }
  const body = result.body as { attributes?: AttributeSummary[] };
  return body.attributes ?? [];
}

async function waitForAttribute(
  baseUrl: string,
  key: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await request(`${baseUrl}/attributes`, 'GET');
    if (result.status !== 200) {
      throw new Error(`GET attributes failed while waiting: ${describe(result)}`);
    }
    const body = result.body as { attributes?: AttributeSummary[] };
    const attribute = (body.attributes ?? []).find((entry) => entry.key === key);
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

async function waitForIndex(key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const indexes = await getSubscriptionIndexes();
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
  detail: string;
}

/**
 * Collection `telegram_subscriptions` (design D7): permissions mirror the
 * `tasks` collection — any authenticated user may create a document, only the
 * `admins` team reads at collection level, and `documentSecurity` lets each
 * document carry its own `read/write("user:<uid>")` grants.
 */
async function ensureCollection(): Promise<StepOutcome> {
  const existing = await request(subscriptionsBaseUrl, 'GET');
  if (existing.status === 200) {
    return {
      step: 'collection.telegram_subscriptions',
      changed: false,
      detail: 'collection already present — skipped',
    };
  }
  if (existing.status !== 404) {
    throw new Error(`GET telegram_subscriptions failed: ${describe(existing)}`);
  }

  const created = await request(collectionsUrl, 'POST', {
    collectionId: SUBSCRIPTIONS_COLLECTION_ID,
    name: 'Telegram subscriptions',
    permissions: ['create("users")', 'read("team:admins")'],
    documentSecurity: true,
    enabled: true,
  });
  if (created.status !== 201 && created.status !== 202) {
    throw new Error(`createCollection failed: ${describe(created)}`);
  }

  return {
    step: 'collection.telegram_subscriptions',
    changed: true,
    detail: `createCollection OK (${describe(created)})`,
  };
}

/** Design D7 attribute table: `userId` required; the rest default to unlinked. */
const SUBSCRIPTION_ATTRIBUTES: Array<[string, string, Record<string, unknown>]> = [
  ['userId', '/attributes/string', { key: 'userId', size: 36, required: true }],
  ['chatId', '/attributes/string', { key: 'chatId', size: 40, required: false, default: '' }],
  ['active', '/attributes/boolean', { key: 'active', required: false, default: false }],
  ['token', '/attributes/string', { key: 'token', size: 64, required: false, default: '' }],
  [
    'tokenExpiresAt',
    '/attributes/string',
    { key: 'tokenExpiresAt', size: 30, required: false, default: '' },
  ],
];

async function ensureAttribute(
  key: string,
  path: string,
  body: Record<string, unknown>,
): Promise<StepOutcome> {
  const attributes = await getSubscriptionAttributes();
  const existing = attributes.find((entry) => entry.key === key);
  if (existing !== undefined) {
    if (existing.status !== 'available') {
      await waitForAttribute(subscriptionsBaseUrl, key);
    }
    return { step: `attribute.${key}`, changed: false, detail: 'already present — skipped' };
  }

  const created = await request(`${subscriptionsBaseUrl}${path}`, 'POST', body);
  if (created.status !== 201 && created.status !== 202) {
    throw new Error(`create ${key} attribute failed: ${describe(created)}`);
  }
  await waitForAttribute(subscriptionsBaseUrl, key);

  return { step: `attribute.${key}`, changed: true, detail: `create OK (${describe(created)})` };
}

/** Design D7 indexes: `user_id` unique(`userId`), `token` key(`token`). */
const SUBSCRIPTION_INDEXES: Array<[string, Record<string, unknown>]> = [
  ['user_id', { key: 'user_id', type: 'unique', attributes: ['userId'], orders: ['asc'] }],
  ['token', { key: 'token', type: 'key', attributes: ['token'], orders: ['asc'] }],
];

async function ensureIndex(
  key: string,
  body: Record<string, unknown>,
): Promise<StepOutcome> {
  const indexes = await getSubscriptionIndexes();
  const existingIndex = indexes.find((entry) => entry.key === key);
  if (existingIndex !== undefined) {
    if (existingIndex.status !== 'available') {
      await waitForIndex(key);
    }
    return { step: `index.${key}`, changed: false, detail: 'already present — skipped' };
  }

  const created = await request(`${subscriptionsBaseUrl}/indexes`, 'POST', body);
  if (created.status !== 201 && created.status !== 202) {
    throw new Error(`create ${key} index failed: ${describe(created)}`);
  }
  await waitForIndex(key);

  return { step: `index.${key}`, changed: true, detail: `create OK (${describe(created)})` };
}

/**
 * Probe (design D7): `tasks.notified` boolean, `required:false`,
 * `default:false`. Self-hosted Appwrite 1.8.1 support for `default` on
 * boolean attribute create is unverified — a rejection retries WITHOUT the
 * default. Never writes a document, never backfills, never indexes.
 */
async function ensureNotifiedAttribute(): Promise<StepOutcome> {
  const step = 'attribute.tasks.notified';
  const attributes = await getTasksAttributes();
  const existing = attributes.find((entry) => entry.key === 'notified');
  if (existing !== undefined) {
    if (existing.status !== 'available') {
      await waitForAttribute(tasksBaseUrl, 'notified');
    }
    return { step, changed: false, detail: 'already present — skipped' };
  }

  const withDefault = await request(`${tasksBaseUrl}/attributes/boolean`, 'POST', {
    key: 'notified',
    required: false,
    default: false,
  });

  if (withDefault.status === 201 || withDefault.status === 202) {
    await waitForAttribute(tasksBaseUrl, 'notified');
    return { step, changed: true, detail: `create OK with default:false (${describe(withDefault)})` };
  }

  console.warn(`[probe] default:false rejected: ${describe(withDefault)}`);
  console.warn('[probe] retrying WITHOUT default — read path accepts null as unnotified');

  const withoutDefault = await request(`${tasksBaseUrl}/attributes/boolean`, 'POST', {
    key: 'notified',
    required: false,
  });
  if (withoutDefault.status !== 201 && withoutDefault.status !== 202) {
    throw new Error(`notified attribute create failed: ${describe(withoutDefault)}`);
  }
  await waitForAttribute(tasksBaseUrl, 'notified');

  return {
    step,
    changed: true,
    detail: `fallback without default OK (${describe(withoutDefault)})`,
  };
}

async function snapshot(): Promise<string> {
  const lines: string[] = [];

  const collection = await request(subscriptionsBaseUrl, 'GET');
  lines.push(`  telegram_subscriptions: ${collection.status === 200 ? 'exists' : 'absent'}`);

  if (collection.status === 200) {
    const attributes = await getSubscriptionAttributes();
    lines.push(
      `  attributes: ${attributes.map((entry) => `${entry.key}(${entry.status ?? '?'})`).join(', ') || 'none'}`,
    );
    const indexes = await getSubscriptionIndexes();
    lines.push(
      `  indexes: ${indexes.map((entry) => `${entry.key}(${entry.status ?? '?'})`).join(', ') || 'none'}`,
    );
  }

  const tasksAttributes = await getTasksAttributes();
  const notified = tasksAttributes.find((entry) => entry.key === 'notified');
  lines.push(`  tasks.notified: ${notified === undefined ? 'absent' : `present (${notified.status ?? '?'})`}`);

  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log(
    `Provisioning reminders schema on ${env.databaseId} (project ${env.projectId})`,
  );
  console.log(`Endpoint: ${env.endpoint}`);

  console.log('\nBEFORE:');
  console.log(await snapshot());

  const outcomes: StepOutcome[] = [];

  outcomes.push(await ensureCollection());
  for (const [key, path, body] of SUBSCRIPTION_ATTRIBUTES) {
    outcomes.push(await ensureAttribute(key, path, body));
  }
  for (const [key, body] of SUBSCRIPTION_INDEXES) {
    outcomes.push(await ensureIndex(key, body));
  }
  outcomes.push(await ensureNotifiedAttribute());

  console.log('\nAFTER:');
  console.log(await snapshot());

  console.log('\nProvisioning summary:');
  for (const outcome of outcomes) {
    const marker = outcome.changed ? 'APPLIED' : 'SKIP';
    console.log(`  [${marker}] ${outcome.step} — ${outcome.detail}`);
  }

  const applied = outcomes.filter((outcome) => outcome.changed).length;
  console.log(`\nDone. Steps applied: ${applied}/${outcomes.length} (re-run is a no-op).`);
}

main().catch((error: unknown) => {
  console.error('Provisioning failed:', error);
  process.exitCode = 1;
});
