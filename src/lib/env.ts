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

/** The six OPTIONAL reminder keys (design "Env Contract") — never `NEXT_PUBLIC_*`. */
export const REMINDER_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_LINK_SECRET',
  'REMINDERS_ENABLED',
  'REMINDERS_POLL_SECONDS',
  'TELEGRAM_CALLBACK_ORIGIN',
] as const;

export type ReminderEnvKey = (typeof REMINDER_ENV_KEYS)[number];

/**
 * Optional reminder env (design D9 / "Env Contract"): `enabled:false` carries
 * a human reason, `enabled:true` carries the resolved values.
 */
export type ReminderEnv =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      botToken: string;
      botUsername: string;
      linkSecret: string;
      callbackOrigin: string;
      pollSeconds: number;
    };

/** Design "Env Contract" defaults. */
export const DEFAULT_POLL_SECONDS = 60;
export const DEFAULT_CALLBACK_ORIGIN = 'http://127.0.0.1:3000';

/** The three keys whose presence gates the feature (design Env Contract). */
const REQUIRED_TELEGRAM_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_LINK_SECRET',
] as const;

function parsePollSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_POLL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_POLL_SECONDS;
  }
  return parsed;
}

/**
 * Non-throwing reminder env loader (spec `reminder-delivery` → "Disabled or
 * unconfigured reminders"): absence disables, an invalid value falls back to
 * its default, and this function NEVER throws so the app boots without any
 * Telegram configuration. Reads `process.env` at call time by default.
 */
export function loadReminderEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ReminderEnv {
  const missing = REQUIRED_TELEGRAM_KEYS.filter((key) => !source[key]);
  if (missing.length > 0) {
    return { enabled: false, reason: `missing ${missing.join(', ')}` };
  }

  if (source.REMINDERS_ENABLED === 'false') {
    return { enabled: false, reason: 'REMINDERS_ENABLED=false' };
  }

  return {
    enabled: true,
    botToken: source.TELEGRAM_BOT_TOKEN as string,
    botUsername: source.TELEGRAM_BOT_USERNAME as string,
    linkSecret: source.TELEGRAM_LINK_SECRET as string,
    callbackOrigin:
      source.TELEGRAM_CALLBACK_ORIGIN && source.TELEGRAM_CALLBACK_ORIGIN !== ''
        ? source.TELEGRAM_CALLBACK_ORIGIN
        : DEFAULT_CALLBACK_ORIGIN,
    pollSeconds: parsePollSeconds(source.REMINDERS_POLL_SECONDS),
  };
}
