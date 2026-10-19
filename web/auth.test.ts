import { expect, test } from 'vite-plus/test';
import configureAuth, { mapGitHubProfileToUser } from './auth.ts';

test('maps the GitHub login without exposing profile email', () => {
  const profile = {
    email: 'private@example.com',
    login: 'octocat',
  };
  expect(mapGitHubProfileToUser(profile)).toEqual({
    displayUsername: 'octocat',
    username: 'octocat',
  });
});

test('supports Void schema generation without runtime provider defaults', () => {
  expect(
    configureAuth({
      defaults: {},
      dialect: 'sqlite',
      env: {},
      request: new Request('http://localhost/api/auth'),
    }),
  ).toMatchObject({
    account: { encryptOAuthTokens: true },
    session: {
      cookieCache: { enabled: true, maxAge: 60 * 60, strategy: 'jwe' },
    },
    user: {
      additionalFields: {
        displayUsername: { type: 'string' },
        username: { type: 'string', unique: true },
      },
    },
  });
});
