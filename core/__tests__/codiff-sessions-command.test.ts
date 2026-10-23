import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { runSessionsCommand } from '../../bin/sessions-command.js';

const run = async (
  args: ReadonlyArray<string>,
  response: { sessions: ReadonlyArray<unknown> } | null | Error,
) => {
  let stdout = '';
  let stderr = '';
  const exitCode = await runSessionsCommand(args, {
    requestSessions: async () => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    stderr: { write: (text: string) => (stderr += text) },
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
  expect(result.stderr).toBe('codiff-sessions: Codiff did not respond in time.\n');
});
