import { getAuthenticatedShareUser } from '@nkzw/codiff-service/api';
import { expect, test, vi } from 'vite-plus/test';
import { authContext, type AuthState } from 'void/auth';
import { getRequestAuth } from './auth.ts';

const request = new Request('https://codiff.dev/api/upload-intents');
const now = new Date();
const user = {
  createdAt: now,
  email: 'user@example.com',
  emailVerified: true,
  id: 'user-1',
  name: 'User',
  updatedAt: now,
};
const state: AuthState = {
  session: {
    createdAt: now,
    expiresAt: new Date(+now + 3_600_000),
    id: 'session-1',
    token: 'token',
    updatedAt: now,
    userId: user.id,
  },
  user,
};

test('reuses the authenticated middleware session in the sharing service', async () => {
  const getSession = vi.fn(() => {
    throw new Error('Session must not be fetched again.');
  });
  await authContext.run({ state, user }, async () => {
    const auth = getRequestAuth({ api: { getSession } });
    expect(await getAuthenticatedShareUser(request, auth)).toMatchObject({
      id: user.id,
      name: user.name,
    });
    expect(await getAuthenticatedShareUser(request, auth)).toMatchObject({ id: user.id });
  });
  expect(getSession).not.toHaveBeenCalled();
});

test('reuses an anonymous middleware result instead of looking up a session', async () => {
  const getSession = vi.fn(() => {
    throw new Error('Session must not be fetched again.');
  });
  await authContext.run({ state: null, user: null }, async () => {
    expect(
      await getAuthenticatedShareUser(request, getRequestAuth({ api: { getSession } })),
    ).toBeNull();
    expect(getRequestAuth(null)).toBeNull();
  });
  expect(getSession).not.toHaveBeenCalled();
});

test('uses the original auth API outside Void middleware', async () => {
  const auth = { api: { getSession: vi.fn(async () => state) } };
  expect(getRequestAuth(auth)).toBe(auth);
  expect(await getAuthenticatedShareUser(request, getRequestAuth(auth))).toMatchObject({
    id: user.id,
  });
  expect(auth.api.getSession).toHaveBeenCalledOnce();
});
