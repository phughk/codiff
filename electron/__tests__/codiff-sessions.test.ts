import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

type SessionsResponse = { sessions: ReadonlyArray<unknown> };

const require = createRequire(import.meta.url);
type SessionsRequest =
  | { type: 'list' }
  | { agentId?: string; body: string; commentId: string; sessionId: number; type: 'reply' };

const { replyToSessionComment, requestSessions, startSessionsServer } =
  require('../codiff-sessions.cjs') as {
    replyToSessionComment: (
      reply: { agentId?: string; body: string; commentId: string; sessionId: number },
      options?: { socketPath?: string },
    ) => Promise<boolean>;
    requestSessions: (options?: { socketPath?: string }) => Promise<SessionsResponse | null>;
    startSessionsServer: (options: {
      handleRequest: (request: SessionsRequest) => Promise<object>;
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
  const server = startSessionsServer({ handleRequest: async () => ({ sessions }), socketPath });
  cleanups.push(() => server.close());

  await expect(requestSessions({ socketPath })).resolves.toEqual({ sessions });
});

test('resolves null when no app is listening', async () => {
  await expect(requestSessions({ socketPath: await createSocketPath() })).resolves.toBe(null);
});

test('replaces a stale socket left by a previous app', async () => {
  const socketPath = await createSocketPath();
  const stale = startSessionsServer({ handleRequest: async () => ({ sessions: [] }), socketPath });
  // Simulate a crash: the old server is gone but the next start must still bind.
  const server = startSessionsServer({
    handleRequest: async () => ({ sessions: [{ id: 2 }] }),
    socketPath,
  });
  cleanups.push(
    () => server.close(),
    () => stale.close(),
  );

  await expect(requestSessions({ socketPath })).resolves.toEqual({ sessions: [{ id: 2 }] });
});

test('reports errors from the app', async () => {
  const socketPath = await createSocketPath();
  const server = startSessionsServer({
    handleRequest: async () => {
      throw new Error('Window crashed.');
    },
    socketPath,
  });
  cleanups.push(() => server.close());

  await expect(requestSessions({ socketPath })).rejects.toThrow('Window crashed.');
});

test('forwards a reply to the app', async () => {
  const socketPath = await createSocketPath();
  const requests: Array<SessionsRequest> = [];
  const server = startSessionsServer({
    handleRequest: async (request) => {
      requests.push(request);
      return { status: 'ok' };
    },
    socketPath,
  });
  cleanups.push(() => server.close());

  await expect(
    replyToSessionComment(
      { agentId: 'claude', body: 'Fixed.', commentId: 'a', sessionId: 3 },
      { socketPath },
    ),
  ).resolves.toBe(true);
  expect(requests).toEqual([
    { agentId: 'claude', body: 'Fixed.', commentId: 'a', sessionId: 3, type: 'reply' },
  ]);
});

test('rejects malformed replies before they reach the app', async () => {
  const socketPath = await createSocketPath();
  const server = startSessionsServer({
    handleRequest: async () => ({ status: 'ok' }),
    socketPath,
  });
  cleanups.push(() => server.close());

  await expect(
    replyToSessionComment({ body: '  ', commentId: 'a', sessionId: 3 }, { socketPath }),
  ).rejects.toThrow('Unsupported request.');
});
