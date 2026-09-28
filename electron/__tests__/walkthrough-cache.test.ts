import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);

let home = '';
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'codiff-walkthrough-cache-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (previousHome == null) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  rmSync(home, { force: true, recursive: true });
});

const loadModules = () => {
  for (const module of ['../walkthrough-store.cjs', '../walkthrough-cache.cjs']) {
    delete require.cache[require.resolve(module)];
  }
  return {
    cache: require('../walkthrough-cache.cjs') as {
      createWalkthroughCache: (options?: {
        getMaxAgeDays?: () => number | undefined;
        now?: () => number;
      }) => {
        read: (state: any, agent: any, model: unknown, options?: any) => any;
        write: (state: any, agent: any, model: unknown, walkthrough: any, options?: any) => void;
      };
      getNarrativeWalkthroughCacheKey: (
        state: any,
        agent: any,
        model: unknown,
        customPrompt?: string,
      ) => string;
    },
    store: require('../walkthrough-store.cjs') as typeof import('../walkthrough-store.cjs'),
  };
};

const { normalizeNarrativeWalkthrough } = require('../narrative-walkthrough.cjs') as {
  normalizeNarrativeWalkthrough: (input: unknown, files: any, facts?: any) => any;
};

const agent = {
  id: 'claude',
  label: 'Claude Code',
  normalizeModel: (model: unknown) => String(model || 'default'),
};

const appPatch = '@@ -1,3 +1,3 @@\n context\n-old order\n+new order\n context\n';
const lockPatch = '@@ -0,0 +1 @@\n+lock\n';

/** The same diff, read from the given scope (staged edits, a commit, a PR…). */
const createState = (scope: string, source: Record<string, unknown>, patch = appPatch) => ({
  branch: 'main',
  files: [
    {
      fingerprint: `${scope}-app`,
      path: 'src/App.tsx',
      sections: [{ id: `src/App.tsx:${scope}`, kind: 'commit', patch }],
      status: 'modified',
    },
    {
      fingerprint: `${scope}-lock`,
      path: 'pnpm-lock.yaml',
      sections: [{ id: `pnpm-lock.yaml:${scope}`, kind: 'commit', patch: lockPatch }],
      status: 'modified',
    },
  ],
  generatedAt: 1,
  root: '/repo',
  source,
});

const stagedState = createState('staged', { type: 'working-tree' });
const commitSha = 'a'.repeat(40);
const commitState = createState(commitSha, { ref: commitSha, type: 'commit' });

const generateWalkthrough = (state: ReturnType<typeof createState>, title = 'Ordering fix') => {
  const scope = state.files[0].sections[0].id.split(':').at(-1);
  return normalizeNarrativeWalkthrough(
    {
      chapters: [
        {
          blurb: 'The fix.',
          icon: 'bug',
          id: 'bug',
          stops: [
            {
              after: 'Files keep their new order.',
              before: 'Files used the old order.',
              hunkIds: [`src/App.tsx:${scope}:h1`],
              id: 's1',
              importance: 'critical',
              notes: [{ body: 'The root cause.', hunkId: `src/App.tsx:${scope}:h1` }],
              prose: 'The root cause line.',
              title: 'Fix ordering',
              why: 'Navigation skipped files.',
            },
          ],
          title: 'Bug',
        },
      ],
      commit: { body: 'Keep the order.', title: 'Fix ordering' },
      focus: 'An ordering bug.',
      title,
    },
    state.files,
    {
      agent: 'claude',
      branch: state.branch,
      generatedAt: '2026-09-28T10:00:00.000Z',
      root: state.root,
      source: state.source,
    },
  );
};

test('reuses a walkthrough for the same diff read from another source', () => {
  const { cache } = loadModules();
  const walkthroughCache = cache.createWalkthroughCache();
  walkthroughCache.write(stagedState, agent, 'sonnet', generateWalkthrough(stagedState));

  const cached = walkthroughCache.read(commitState, agent, 'sonnet', {
    context: { summary: 'Prior discussion' },
  });

  expect(cached).not.toBe(null);
  expect(cached.title).toBe('Ordering fix');
  expect(cached.generatedAt).toBe('2026-09-28T10:00:00.000Z');
  expect(cached.source).toEqual(commitState.source);
  expect(cached.context).toEqual({ summary: 'Prior discussion' });
  const [stop] = cached.chapters[0].stops;
  expect(stop.hunkIds).toEqual([`src/App.tsx:${commitSha}:h1`]);
  expect(stop.hunks[0].anchor.sectionId).toBe(`src/App.tsx:${commitSha}`);
  expect(stop.notes).toEqual([{ body: 'The root cause.', hunkId: `src/App.tsx:${commitSha}:h1` }]);
  expect(stop).toMatchObject({
    after: 'Files keep their new order.',
    before: 'Files used the old order.',
    why: 'Navigation skipped files.',
  });
  expect(cached.support[0].hunkIds).toEqual([`pnpm-lock.yaml:${commitSha}:h1`]);
  // A commit composer only applies to a working tree.
  expect(cached.commit).toBeUndefined();
  expect(walkthroughCache.read(stagedState, agent, 'sonnet').commit).toEqual({
    body: 'Keep the order.',
    title: 'Fix ordering',
  });
});

test('misses when the diff changes and replaces the entry when regenerated', () => {
  const { cache } = loadModules();
  const walkthroughCache = cache.createWalkthroughCache();
  walkthroughCache.write(stagedState, agent, 'sonnet', generateWalkthrough(stagedState));

  const editedState = createState(
    'staged',
    { type: 'working-tree' },
    '@@ -1,3 +1,3 @@\n context\n-old order\n+newer order\n context\n',
  );
  expect(walkthroughCache.read(editedState, agent, 'sonnet')).toBe(null);

  walkthroughCache.write(
    stagedState,
    agent,
    'sonnet',
    generateWalkthrough(stagedState, 'Regenerated'),
  );
  expect(walkthroughCache.read(stagedState, agent, 'sonnet').title).toBe('Regenerated');
});

test('keys the cache on the diff and generation settings, not the review source', () => {
  const { cache } = loadModules();
  const key = cache.getNarrativeWalkthroughCacheKey(stagedState, agent, 'sonnet');
  const pullRequestState = createState('pull-request:42', {
    description: 'Explain the change.',
    headSha: 'head-1',
    number: 42,
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/42',
  });

  expect(cache.getNarrativeWalkthroughCacheKey(commitState, agent, 'sonnet')).toBe(key);
  expect(cache.getNarrativeWalkthroughCacheKey(pullRequestState, agent, 'sonnet')).toBe(key);
  expect(
    cache.getNarrativeWalkthroughCacheKey({ ...stagedState, branch: 'other' }, agent, 'sonnet'),
  ).toBe(key);
  expect(
    cache.getNarrativeWalkthroughCacheKey(
      { ...stagedState, files: [...stagedState.files].reverse() },
      agent,
      'sonnet',
    ),
  ).toBe(key);

  expect(cache.getNarrativeWalkthroughCacheKey(stagedState, agent, 'opus')).not.toBe(key);
  expect(
    cache.getNarrativeWalkthroughCacheKey(stagedState, { ...agent, id: 'codex' }, 'sonnet'),
  ).not.toBe(key);
  expect(
    cache.getNarrativeWalkthroughCacheKey(stagedState, agent, 'sonnet', 'Be concise.'),
  ).not.toBe(key);
  const renamedState = {
    ...stagedState,
    files: [{ ...stagedState.files[0], path: 'src/Main.tsx' }, stagedState.files[1]],
  };
  expect(cache.getNarrativeWalkthroughCacheKey(renamedState, agent, 'sonnet')).not.toBe(key);
  const deferredState = (fingerprint: string) => ({
    ...stagedState,
    files: [
      {
        ...stagedState.files[0],
        sections: [
          {
            id: 'src/App.tsx:staged',
            kind: 'staged',
            loadState: 'deferred',
            summary: { fingerprint, reason: 'Large file.' },
          },
        ],
      },
    ],
  });
  // Sections without a patch are identified by their contents' fingerprint.
  expect(cache.getNarrativeWalkthroughCacheKey(deferredState('one'), agent, 'sonnet')).not.toBe(
    cache.getNarrativeWalkthroughCacheKey(deferredState('two'), agent, 'sonnet'),
  );
});

test('prunes old entries and disables the cache at a max age of zero', () => {
  const { cache, store } = loadModules();
  let now = Date.now();
  let maxAgeDays = 7;
  const walkthroughCache = cache.createWalkthroughCache({
    getMaxAgeDays: () => maxAgeDays,
    now: () => now,
  });
  walkthroughCache.write(stagedState, agent, 'sonnet', generateWalkthrough(stagedState));
  expect(walkthroughCache.read(stagedState, agent, 'sonnet')).not.toBe(null);

  const path = store.getWalkthroughStorePath(
    cache.getNarrativeWalkthroughCacheKey(stagedState, agent, 'sonnet'),
  );
  // Pruning is throttled to once an hour and measures age from the last use.
  now += 8 * 24 * 60 * 60 * 1000;
  expect(walkthroughCache.read(stagedState, agent, 'sonnet')).toBe(null);
  expect(existsSync(path)).toBe(false);

  maxAgeDays = 0;
  walkthroughCache.write(stagedState, agent, 'sonnet', generateWalkthrough(stagedState));
  expect(existsSync(path)).toBe(false);
  expect(walkthroughCache.read(stagedState, agent, 'sonnet')).toBe(null);
});
