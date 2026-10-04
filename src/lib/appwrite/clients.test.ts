import { describe, expect, it } from 'vitest';
import { createAdminClient, createSessionClient } from './clients';

const testEnv = {
  APPWRITE_ENDPOINT: 'https://appwrite.test/v1',
  APPWRITE_PROJECT_ID: 'project-test',
  APPWRITE_API_KEY: 'standard_test_key',
  APPWRITE_DATABASE_ID: 'agenda',
  APPWRITE_TASKS_COLLECTION_ID: 'tasks',
  APPWRITE_ADMINS_TEAM_ID: 'admins',
};

describe('createSessionClient', () => {
  it('authenticates with the cookie secret only, never the API key', () => {
    const client = createSessionClient('cookie-secret', testEnv);

    expect(client.config.session).toBe('cookie-secret');
    expect(client.config.key).toBe('');
    expect(client.config.endpoint).toBe(testEnv.APPWRITE_ENDPOINT);
    expect(client.config.project).toBe(testEnv.APPWRITE_PROJECT_ID);
    expect(client.headers['X-Appwrite-Session']).toBe('cookie-secret');
    expect(client.headers['X-Appwrite-Key']).toBeUndefined();
  });

  it('builds a fresh anonymous client when no secret is given (login flow)', () => {
    const client = createSessionClient(null, testEnv);

    expect(client.config.session).toBe('');
    expect(client.headers['X-Appwrite-Session']).toBeUndefined();
    expect(client.config.project).toBe(testEnv.APPWRITE_PROJECT_ID);
  });
});

describe('createAdminClient', () => {
  it('authenticates with the server API key only, never a session', () => {
    const client = createAdminClient(testEnv);

    expect(client.config.key).toBe(testEnv.APPWRITE_API_KEY);
    expect(client.config.session).toBe('');
    expect(client.headers['X-Appwrite-Key']).toBe(testEnv.APPWRITE_API_KEY);
    expect(client.headers['X-Appwrite-Session']).toBeUndefined();
  });
});
