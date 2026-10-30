import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { runSessionsCommand } from '../../bin/sessions-command.js';

type Reply = { agentId?: string; body: string; commentId: string; sessionId: number };

const run = async (
  args: ReadonlyArray<string>,
  response: { sessions: ReadonlyArray<unknown> } | null | Error,
  { replies = [], stdin = [] }: { replies?: Array<Reply>; stdin?: ReadonlyArray<string> } = {},
) => {
  let stdout = '';
  let stderr = '';
  const exitCode = await runSessionsCommand(args, {
    replyToSessionComment: async (reply: Reply) => {
      if (response instanceof Error) {
        throw response;
      }
      replies.push(reply);
      return response != null;
    },
    requestSessions: async () => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    stderr: { write: (text: string) => (stderr += text) },
    stdin: (async function* () {
      yield* stdin;
    })(),
    stdout: { write: (text: string) => (stdout += text) },
  });
  return { exitCode, stderr, stdout };
};

test('prints every session as JSON', async () => {
  const sessions = [{ comments: [{ body: 'Rename this.' }], id: 1, repositoryRoot: '/a' }];
  const result = await run([], { sessions });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ running: true, sessions });
});

test('reports when Codiff is not running', async () => {
  const result = await run([], null);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ running: false, sessions: [] });
});

test('filters sessions to the repository containing a path', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'codiff-sessions-cli-')));
  try {
    const result = await run([directory], {
      sessions: [
        { comments: [], id: 1, repositoryRoot: directory },
        { comments: [], id: 2, repositoryRoot: '/elsewhere' },
      ],
    });

    expect(JSON.parse(result.stdout).sessions.map((session: { id: number }) => session.id)).toEqual(
      [1],
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails when the app returns an error', async () => {
  const result = await run([], new Error('Codiff did not respond in time.'));

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe('codiff sessions: Codiff did not respond in time.\n');
});

test('replies to a session comment', async () => {
  const replies: Array<Reply> = [];
  const result = await run(
    ['reply', '--agent', 'claude', '7', 'comment-1', 'Renamed', 'it.'],
    { sessions: [] },
    { replies },
  );

  expect(result.exitCode).toBe(0);
  expect(replies).toEqual([
    { agentId: 'claude', body: 'Renamed it.', commentId: 'comment-1', sessionId: 7 },
  ]);
});

test('reads a reply body from stdin', async () => {
  const replies: Array<Reply> = [];
  const result = await run(
    ['reply', '7', 'comment-1', '-'],
    { sessions: [] },
    { replies, stdin: ['Line one.\n', 'Line two.\n'] },
  );

  expect(result.exitCode).toBe(0);
  expect(replies).toEqual([{ body: 'Line one.\nLine two.', commentId: 'comment-1', sessionId: 7 }]);
});

test('rejects replies without a numeric session id or with an unknown agent', async () => {
  expect((await run(['reply', 'abc', 'comment-1', 'Hi'], { sessions: [] })).exitCode).toBe(1);
  expect(
    (await run(['reply', '--agent', 'gpt', '7', 'comment-1', 'Hi'], { sessions: [] })).exitCode,
  ).toBe(1);
});

test('fails to reply when Codiff is not running', async () => {
  const result = await run(['reply', '7', 'comment-1', 'Hi'], null);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe('codiff sessions: Codiff is not running.\n');
});
