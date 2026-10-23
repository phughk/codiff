import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

type SessionsResponse = { sessions: ReadonlyArray<unknown> };

const require = createRequire(import.meta.url);
const { requestSessions, startSessionsServer } = require('../codiff-sessions.cjs') as {
  requestSessions: (options?: { socketPath?: string }) => Promise<SessionsResponse | null>;
  startSessionsServer: (options: {
    listSessions: () => Promise<ReadonlyArray<unknown>>;
    socketPath?: string;
  }) => { close: () => void };
};

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const createSocketPath = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-sessions-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  return join(directory, 'sessions.sock');
};

test('returns the sessions listed by the running app', async () => {
  const socketPath = await createSocketPath();
  const sessions = [{ comments: [{ body: 'Rename this.', id: 'a' }], id: 1 }];
  const server = startSessionsServer({ listSessions: async () => sessions, socketPath });
  cleanups.push(() => server.close());

  await expect(requestSessions({ socketPath })).resolves.toEqual({ sessions });
});

test('resolves null when no app is listening', async () => {
  await expect(requestSessions({ socketPath: await createSocketPath() })).resolves.toBe(null);
});

test('replaces a stale socket left by a previous app', async () => {
  const socketPath = await createSocketPath();
  const stale = startSessionsServer({ listSessions: async () => [], socketPath });
  // Simulate a crash: the old server is gone but the next start must still bind.
  const server = startSessionsServer({ listSessions: async () => [{ id: 2 }], socketPath });
  cleanups.push(
    () => server.close(),
    () => stale.close(),
  );

  await expect(requestSessions({ socketPath })).resolves.toEqual({ sessions: [{ id: 2 }] });
});

test('reports errors from the app', async () => {
  const socketPath = await createSocketPath();
  const server = startSessionsServer({
    listSessions: async () => {
      throw new Error('Window crashed.');
    },
    socketPath,
  });
  cleanups.push(() => server.close());

  await expect(requestSessions({ socketPath })).rejects.toThrow('Window crashed.');
});
