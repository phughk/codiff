import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import { getGitTestEnvironment, withGitTestEnvironment } from '../../core/__tests__/helpers/git.ts';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';
import type { ReviewSource } from '../../core/types.ts';

const require = createRequire(import.meta.url);
const { createEditorCheckoutResolver, parseWorktreeList } =
  require('../main/editor-checkout.cjs') as {
    createEditorCheckoutResolver: (options?: { worktreeDirectory?: string }) => {
      resolveEditorRoot: (repoRoot: string, source: ReviewSource | undefined) => Promise<string>;
    };
    parseWorktreeList: (
      raw: string,
    ) => Array<{ branch: string | null; head: string | null; path: string }>;
  };

const execFileAsync = promisify(execFile);

const git = async (repository: string, args: ReadonlyArray<string>) => {
  const { stdout } = await execFileAsync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: getGitTestEnvironment(),
  });
  return stdout.trim();
};

const createRepository = async (path: string) => {
  const repository = join(path, 'repo');
  await execFileAsync('git', ['init', '-q', '-b', 'main', repository], {
    env: getGitTestEnvironment(),
  });
  await writeFile(join(repository, 'file.txt'), 'first\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-q', '-m', 'first']);
  const first = await git(repository, ['rev-parse', 'HEAD']);
  await writeFile(join(repository, 'file.txt'), 'second\n');
  await git(repository, ['commit', '-q', '-am', 'second']);
  const second = await git(repository, ['rev-parse', 'HEAD']);
  return { first, repository, second };
};

test('parses porcelain worktree listings', () => {
  expect(
    parseWorktreeList(
      'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /tmp/wt\nHEAD def\ndetached\n',
    ),
  ).toEqual([
    { branch: 'refs/heads/main', head: 'abc', path: '/repo' },
    { branch: null, head: 'def', path: '/tmp/wt' },
  ]);
});

test('opens checked-out sources in the repository itself', async () => {
  await using directory = await createTemporaryDirectory('codiff-editor-checkout-');
  const { repository, second } = await createRepository(directory.path);
  const { resolveEditorRoot } = createEditorCheckoutResolver({
    worktreeDirectory: join(directory.path, 'worktrees'),
  });

  for (const source of [
    undefined,
    { type: 'working-tree' },
    { ref: 'main', type: 'branch' },
    { ref: second, type: 'commit' },
    { base: 'HEAD~1', head: 'main', symmetric: false, type: 'range' },
    { headSha: 'f'.repeat(40), type: 'pull-request', url: 'https://github.com/a/b/pull/1' },
  ] satisfies Array<ReviewSource | undefined>) {
    expect(await resolveEditorRoot(repository, source)).toBe(repository);
  }
});

test('checks out a commit that is not checked out into a reusable temp worktree', async () => {
  await using directory = await createTemporaryDirectory('codiff-editor-checkout-');
  const { first, repository } = await createRepository(directory.path);
  const worktreeDirectory = join(directory.path, 'worktrees');
  const { resolveEditorRoot } = createEditorCheckoutResolver({ worktreeDirectory });

  await withGitTestEnvironment(async () => {
    const source = { ref: first, type: 'commit' } satisfies ReviewSource;
    const [root, concurrentRoot] = await Promise.all([
      resolveEditorRoot(repository, source),
      resolveEditorRoot(repository, source),
    ]);

    expect(root.startsWith(await realpath(worktreeDirectory))).toBe(true);
    expect(concurrentRoot).toBe(root);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('first\n');
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(first);
    expect(await resolveEditorRoot(repository, source)).toBe(root);
  });
});

test('reuses a sibling worktree that already has the commit checked out', async () => {
  await using directory = await createTemporaryDirectory('codiff-editor-checkout-');
  const { first, repository } = await createRepository(directory.path);
  const sibling = join(directory.path, 'sibling');
  await git(repository, ['worktree', 'add', '-q', '-b', 'old', sibling, first]);
  const { resolveEditorRoot } = createEditorCheckoutResolver({
    worktreeDirectory: join(directory.path, 'worktrees'),
  });

  expect(
    await resolveEditorRoot(repository, {
      base: 'main',
      head: 'old',
      symmetric: true,
      type: 'range',
    }),
  ).toBe(await realpath(sibling));
});
