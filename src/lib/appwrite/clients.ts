import { Client } from 'node-appwrite';
import { loadEnv, type ServerEnv } from '@/lib/env';

/**
 * Dual-client setup from design D2: every Appwrite call runs server-side,
 * the browser never talks to Appwrite.
 *
 * - session client — carries only the `aw_session` cookie secret, so Appwrite
 *   enforces document permissions natively (record visibility).
 * - admin client — carries only the server API key, for admin operations.
 *
 * `env` is injectable for tests; production callers use the runtime contract.
 */

/** Fresh client for unauthenticated flows (login), or a session-scoped one when `secret` is given. */
export function createSessionClient(secret: string | null, env: ServerEnv = loadEnv()): Client {
  const client = new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID);

  if (secret !== null) {
    client.setSession(secret);
  }

  return client;
}

/** API-key client for admin operations — never carries a user session. */
export function createAdminClient(env: ServerEnv = loadEnv()): Client {
  return new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);
}
