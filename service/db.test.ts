import { expect, test, vi } from 'vite-plus/test';
import { createPrimaryDb, createRequestDb, type D1Binding } from './db.ts';
import { user } from './schema.ts';

const createBinding = (bookmark: null | string = null) => {
  const session = {
    batch: vi.fn(),
    getBookmark: vi.fn(() => bookmark),
    prepare: vi.fn(() => ({ bind: () => ({ raw: async () => [] }) })),
  };
  const binding = {
    withSession: vi.fn(() => session),
  };
  return { binding: binding as unknown as D1Binding, session, withSession: binding.withSession };
};

test('uses replica sessions and carries their bookmarks without dropping response headers or bodies', async () => {
  const { binding, session, withSession } = createBinding('new-bookmark');
  const database = createRequestDb(
    binding,
    new Request('https://codiff.dev/fate', {
      headers: { cookie: 'other=value; codiff-d1-bookmark=old-bookmark; theme=dark' },
    }),
  );
  await database.db.select().from(user).limit(1);
  expect(withSession).toHaveBeenCalledWith('old-bookmark');
  expect(session.prepare).toHaveBeenCalledOnce();

  const response = database.withBookmark(
    new Response('created', {
      headers: { 'set-cookie': 'existing=value; HttpOnly', 'x-test': 'preserved' },
      status: 201,
      statusText: 'Created',
    }),
  );
  expect(response.status).toBe(201);
  expect(response.statusText).toBe('Created');
  expect(response.headers.get('x-test')).toBe('preserved');
  expect(response.headers.getSetCookie()).toEqual([
    'existing=value; HttpOnly',
    'codiff-d1-bookmark=new-bookmark; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600',
  ]);
  expect(await response.text()).toBe('created');
});

test('starts unconstrained without a valid bookmark and does not set cookies before a query', () => {
  for (const cookie of ['', 'codiff-d1-bookmark=invalid!', 'prefix-codiff-d1-bookmark=unrelated']) {
    const { binding, withSession } = createBinding();
    const database = createRequestDb(
      binding,
      new Request('https://codiff.dev/fate', { headers: { cookie } }),
    );
    expect(withSession).toHaveBeenCalledWith('first-unconstrained');
    const response = new Response('unchanged');
    expect(database.withBookmark(response)).toBe(response);
  }
});

test('does not rewrite an unchanged bookmark', () => {
  const { binding } = createBinding('same-bookmark');
  const database = createRequestDb(
    binding,
    new Request('https://codiff.dev/fate', {
      headers: { cookie: 'codiff-d1-bookmark=same-bookmark' },
    }),
  );
  const response = new Response('unchanged');
  expect(database.withBookmark(response)).toBe(response);
});

test('forces a primary read for operations without the browser bookmark', async () => {
  const { binding, session, withSession } = createBinding();
  await createPrimaryDb(binding).select().from(user).limit(1);
  expect(withSession).toHaveBeenCalledWith('first-primary');
  expect(session.prepare).toHaveBeenCalledOnce();
});
