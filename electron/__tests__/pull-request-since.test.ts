import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { getGitTestEnvironment } from '../../core/__tests__/helpers/git.ts';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { readTreeRebasedOnBase } = require('../git-state/pull-request.cjs') as {
  readTreeRebasedOnBase: (
    repoRoot: string,
    sinceCommit: string,
    currentBase: string,
  ) => Promise<{ conflictPaths: Array<string>; tree: string } | null>;
};

const execFileAsync = promisify(execFile);
const git = async (repository: string, args: ReadonlyArray<string>) => {
  const { stdout } = await execFileAsync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: getGitTestEnvironment(),
  });
  return stdout.trim();
};

const commit = async (repository: string, files: Record<string, string>, message: string) => {
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(repository, path), contents);
  }
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-q', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
};

const createRepository = async (path: string) => {
  const repository = join(path, 'repo');
  await execFileAsync('git', ['init', '-q', '-b', 'main', repository], {
    env: getGitTestEnvironment(),
  });
  await commit(repository, { 'base.txt': 'b1\n', 'feature.txt': 'a\n' }, 'root');
  await git(repository, ['switch', '-q', '-c', 'feature']);
  return repository;
};

const changedPaths = async (repository: string, from: string, to: string) =>
  (await git(repository, ['diff', '--name-only', from, to])).split('\n').filter(Boolean);

test('leaves out changes that came in by merging the base branch', async () => {
  await using directory = await createTemporaryDirectory('codiff-pr-since-');
  const repository = await createRepository(directory.path);
  const reviewed = await commit(repository, { 'feature.txt': 'a\nfirst\n' }, 'first');
  await git(repository, ['switch', '-q', 'main']);
  const base = await commit(repository, { 'base.txt': 'b2\n' }, 'base change');
  await git(repository, ['switch', '-q', 'feature']);
  await git(repository, ['merge', '-q', '--no-edit', 'main']);
  const head = await commit(repository, { 'feature.txt': 'a\nfirst\nsecond\n' }, 'second');

  // A plain comparison drags in the base branch's change.
  expect(await changedPaths(repository, reviewed, head)).toEqual(['base.txt', 'feature.txt']);

  const rebased = await readTreeRebasedOnBase(repository, reviewed, base);
  expect(rebased?.conflictPaths).toEqual([]);
  expect(await changedPaths(repository, rebased!.tree, head)).toEqual(['feature.txt']);
  expect(await git(repository, ['diff', '--no-color', rebased!.tree, head])).toContain('+second');
});

test('uses the commit itself when it already has the current base', async () => {
  await using directory = await createTemporaryDirectory('codiff-pr-since-');
  const repository = await createRepository(directory.path);
  const base = await git(repository, ['rev-parse', 'main']);
  const reviewed = await commit(repository, { 'feature.txt': 'a\nfirst\n' }, 'first');

  expect(await readTreeRebasedOnBase(repository, reviewed, base)).toEqual({
    conflictPaths: [],
    tree: `${reviewed}^{tree}`,
  });
});

test('reports files whose base merge conflicts', async () => {
  await using directory = await createTemporaryDirectory('codiff-pr-since-');
  const repository = await createRepository(directory.path);
  const reviewed = await commit(repository, { 'feature.txt': 'feature\n' }, 'first');
  await git(repository, ['switch', '-q', 'main']);
  const base = await commit(
    repository,
    { 'base.txt': 'b2\n', 'feature.txt': 'base\n' },
    'conflicting base change',
  );

  const rebased = await readTreeRebasedOnBase(repository, reviewed, base);
  expect(rebased?.conflictPaths).toEqual(['feature.txt']);
  expect(rebased?.tree).toMatch(/^[0-9a-f]{40}$/);
});
