/**
 * Env contract (design D4).
 *
 * The six Appwrite variables are server-only. They are read from runtime
 * `process.env` via a computed key so the bundler can never inline the values
 * into the client bundle, and there are zero `NEXT_PUBLIC_*` names by design:
 * the browser never talks to Appwrite.
 */

export const SERVER_ENV_KEYS = [
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'APPWRITE_API_KEY',
  'APPWRITE_DATABASE_ID',
  'APPWRITE_TASKS_COLLECTION_ID',
  'APPWRITE_ADMINS_TEAM_ID',
] as const;

export type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];

export type ServerEnv = Record<ServerEnvKey, string>;

/**
 * Validates the server env contract and returns it.
 *
 * Fails fast with an error that lists every missing key — an empty string
 * counts as missing. Reads `process.env` at call time (never at module scope)
 * so values stay out of the build output for nixpacks.
 */
export function loadEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ServerEnv {
  const missing = SERVER_ENV_KEYS.filter((key) => !source[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Set them in .env.local for local development or in the Easypanel service environment for deploys.',
    );
  }

  const env = {} as ServerEnv;
  for (const key of SERVER_ENV_KEYS) {
    env[key] = source[key] as string;
  }
  return env;
}
