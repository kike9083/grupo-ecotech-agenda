import { describe, expect, it } from 'vitest';
import { SERVER_ENV_KEYS, loadEnv } from './env';

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
