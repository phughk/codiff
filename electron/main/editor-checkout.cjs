// @ts-check

const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { mkdir, realpath } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { git, gitOrEmpty } = require('../git-state/common.cjs');

/**
 * @typedef {import('../../core/types.ts').ReviewSource} ReviewSource
 * @typedef {{branch: string | null; head: string | null; path: string}} Worktree
 */

/** @param {string} raw @returns {Array<Worktree>} */
const parseWorktreeList = (raw) =>
  raw
    .split(/\n\n+/)
    .map((block) => {
      /** @type {Worktree} */
      const worktree = { branch: null, head: null, path: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) {
          worktree.path = line.slice('worktree '.length);
        } else if (line.startsWith('HEAD ')) {
          worktree.head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          worktree.branch = line.slice('branch '.length);
        }
      }
      return worktree;
    })
    .filter(({ path }) => path);

/** @param {string} repoRoot @param {string} ref */
const resolveCommit = async (repoRoot, ref) => {
  const commit = (
    await gitOrEmpty(repoRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${ref}^{commit}`,
    ])
  ).trim();
  return /^[0-9a-f]{40,64}$/i.test(commit) ? commit : null;
};

/**
 * The commit whose files an editor should show for a source, or `null` when the
 * source is always the checked-out working tree. Branch comparisons diff the
 * current branch, so they are always checked out.
 *
 * @param {ReviewSource | undefined} source
 */
const getSourceHeadRef = (source) =>
  source?.type === 'commit'
    ? source.ref
    : source?.type === 'range'
      ? source.head
      : source?.type === 'pull-request'
        ? (source.headSha ?? null)
        : null;

/** @param {{worktreeDirectory?: string}} [options] */
const createEditorCheckoutResolver = ({
  worktreeDirectory = join(tmpdir(), 'codiff-worktrees'),
} = {}) => {
  /** @type {Map<string, Promise<string>>} */
  const pendingWorktrees = new Map();

  /** @param {string} repoRoot @param {string} commit */
  const getWorktreePath = (repoRoot, commit) =>
    join(
      worktreeDirectory,
      `${basename(repoRoot)}-${createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)}`,
      commit.slice(0, 12),
    );

  /** @param {string} repoRoot @param {string} commit @param {string} path */
  const addWorktree = async (repoRoot, commit, path) => {
    // A worktree whose temp directory was cleaned up stays registered and would
    // make `worktree add` refuse the path.
    await gitOrEmpty(repoRoot, ['worktree', 'prune']);
    await mkdir(join(path, '..'), { recursive: true });
    await git(repoRoot, ['worktree', 'add', '--detach', '--end-of-options', path, commit]);
    return realpath(path);
  };

  /**
   * Returns the directory an editor should open as its workspace root for a
   * source: the repository itself when the source's head is checked out there,
   * another worktree that already has it checked out, or a detached worktree in
   * a temp directory. Falls back to the repository when the head is unknown.
   *
   * @param {string} repoRoot
   * @param {ReviewSource | undefined} source
   */
  const resolveEditorRoot = async (repoRoot, source) => {
    const headRef = getSourceHeadRef(source);
    if (!headRef) {
      return repoRoot;
    }

    const commit = await resolveCommit(repoRoot, headRef);
    if (!commit) {
      return repoRoot;
    }

    const worktrees = parseWorktreeList(
      await gitOrEmpty(repoRoot, ['worktree', 'list', '--porcelain']),
    );
    const currentRoot = await realpath(repoRoot).catch(() => repoRoot);
    const checkedOut = worktrees
      .filter(({ head, path }) => head === commit && existsSync(path))
      // Prefer the repository the window belongs to over its sibling worktrees.
      .sort(
        (left, right) => Number(right.path === currentRoot) - Number(left.path === currentRoot),
      );
    if (checkedOut[0]) {
      return checkedOut[0].path === currentRoot ? repoRoot : checkedOut[0].path;
    }

    let path = getWorktreePath(currentRoot, commit);
    const existingPath = await realpath(path).catch(() => null);
    if (existingPath && worktrees.some((worktree) => worktree.path === existingPath)) {
      return existingPath;
    }
    if (existingPath && !pendingWorktrees.has(path)) {
      // Leftover directory that Git no longer tracks as a worktree.
      path = `${path}-${Date.now().toString(36)}`;
    }

    let pending = pendingWorktrees.get(path);
    if (!pending) {
      pending = addWorktree(repoRoot, commit, path).finally(() => pendingWorktrees.delete(path));
      pendingWorktrees.set(path, pending);
    }
    return pending;
  };

  return { resolveEditorRoot };
};

module.exports = { createEditorCheckoutResolver, getSourceHeadRef, parseWorktreeList };
