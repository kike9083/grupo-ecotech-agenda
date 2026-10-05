import { describe, expect, it } from 'vitest';
import { SERVER_ENV_KEYS, loadEnv, loadReminderEnv } from './env';

const fullSource = {
  APPWRITE_ENDPOINT: 'https://appwrite.example/v1',
  APPWRITE_PROJECT_ID: 'project-123',
  APPWRITE_API_KEY: 'standard_secret_key',
  APPWRITE_DATABASE_ID: 'agenda',
  APPWRITE_TASKS_COLLECTION_ID: 'tasks',
  APPWRITE_ADMINS_TEAM_ID: 'admins',
};

describe('loadEnv', () => {
  it('returns every server var when all six are present', () => {
    expect(loadEnv(fullSource)).toEqual(fullSource);
  });

  it('throws an error listing all six keys when the source is empty', () => {
    expect(() => loadEnv({})).toThrowError(
      /APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID, APPWRITE_TASKS_COLLECTION_ID, APPWRITE_ADMINS_TEAM_ID/,
    );
  });

  it('throws listing only the missing keys', () => {
    const { APPWRITE_API_KEY: _apiKey, APPWRITE_ADMINS_TEAM_ID: _team, ...partial } = fullSource;

    expect(() => loadEnv(partial)).toThrowError(/APPWRITE_API_KEY, APPWRITE_ADMINS_TEAM_ID/);
    expect(() => loadEnv(partial)).not.toThrowError(/APPWRITE_ENDPOINT/);
  });

  it('treats an empty-string value as missing', () => {
    expect(() => loadEnv({ ...fullSource, APPWRITE_API_KEY: '' })).toThrowError(
      /APPWRITE_API_KEY/,
    );
  });

  it('keeps the contract server-only: exactly six APPWRITE_ keys, zero NEXT_PUBLIC_', () => {
    expect(SERVER_ENV_KEYS).toHaveLength(6);
    expect(SERVER_ENV_KEYS.some((key) => key.startsWith('NEXT_PUBLIC_'))).toBe(false);
  });
});

const telegramSource = {
  TELEGRAM_BOT_TOKEN: 'bot-token-value',
  TELEGRAM_BOT_USERNAME: 'agenda_recordatorios_bot',
  TELEGRAM_LINK_SECRET: 'link-secret-value',
};

/**
 * Spec `reminder-delivery` → "Disabled or unconfigured reminders": the
 * reminder env contract is OPTIONAL — absence disables, and the app must
 * still boot, so `loadReminderEnv` never throws.
 */
describe('loadReminderEnv (spec reminder-delivery → Disabled or unconfigured reminders)', () => {
  it('reports enabled with the documented defaults when the three TELEGRAM_ keys are present', () => {
    expect(loadReminderEnv({ ...telegramSource })).toEqual({
      enabled: true,
      botToken: 'bot-token-value',
      botUsername: 'agenda_recordatorios_bot',
      linkSecret: 'link-secret-value',
      callbackOrigin: 'http://127.0.0.1:3000',
      pollSeconds: 60,
    });
  });

  it('honours explicit poll interval and callback origin overrides', () => {
    const env = loadReminderEnv({
      ...telegramSource,
      REMINDERS_POLL_SECONDS: '30',
      TELEGRAM_CALLBACK_ORIGIN: 'https://agenda.example.com',
    });

    expect(env).toMatchObject({
      enabled: true,
      pollSeconds: 30,
      callbackOrigin: 'https://agenda.example.com',
    });
  });

  it('falls back to 60 seconds when the poll interval is not a positive integer', () => {
    for (const value of ['not-a-number', '0', '-15', '2.5', '']) {
      const env = loadReminderEnv({
        ...telegramSource,
        REMINDERS_POLL_SECONDS: value,
      });
      expect(env).toMatchObject({ enabled: true, pollSeconds: 60 });
    }
  });

  it('disables and names every missing key instead of throwing', () => {
    expect(loadReminderEnv({})).toEqual({
      enabled: false,
      reason: 'missing TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_LINK_SECRET',
    });

    const { TELEGRAM_LINK_SECRET: _secret, ...withoutSecret } = telegramSource;
    expect(loadReminderEnv(withoutSecret)).toEqual({
      enabled: false,
      reason: 'missing TELEGRAM_LINK_SECRET',
    });

    // An empty string counts as missing (matches the fail-fast loader).
    expect(
      loadReminderEnv({ ...telegramSource, TELEGRAM_BOT_TOKEN: '' }),
    ).toEqual({ enabled: false, reason: 'missing TELEGRAM_BOT_TOKEN' });
  });

  it('disables when REMINDERS_ENABLED is explicitly false', () => {
    const env = loadReminderEnv({
      ...telegramSource,
      REMINDERS_ENABLED: 'false',
    });

    expect(env.enabled).toBe(false);
    if (!env.enabled) {
      expect(env.reason).toBe('REMINDERS_ENABLED=false');
    }
  });

  it('never throws, whatever the source carries', () => {
    expect(() => loadReminderEnv()).not.toThrow();
    expect(loadReminderEnv({})).toMatchObject({ enabled: false });
    expect(() =>
      loadReminderEnv({ ...telegramSource, REMINDERS_POLL_SECONDS: 'NaN' }),
    ).not.toThrow();
  });

  it('keeps the reminder keys out of the public bundle contract', () => {
    expect(SERVER_ENV_KEYS).toHaveLength(6);
    expect(SERVER_ENV_KEYS.some((key) => key.startsWith('TELEGRAM_'))).toBe(
      false,
    );
  });
});
