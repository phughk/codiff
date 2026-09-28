import { createRequire } from 'node:module';
import { expect, test, vi } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { buildAgentReviewInput, readAgentReview } = require('../agent-review.cjs') as {
  buildAgentReviewInput: (state: unknown) => {
    input: { files: ReadonlyArray<{ hunks: ReadonlyArray<{ id: string; lines: string }> }> };
  };
  readAgentReview: (
    state: unknown,
    agent: unknown,
    agentOptions: unknown,
  ) => Promise<{
    comments?: ReadonlyArray<Record<string, unknown>>;
    reason?: string;
    status: string;
    summary?: string;
  }>;
};

const patch = [
  'diff --git a/src/sum.ts b/src/sum.ts',
  '--- a/src/sum.ts',
  '+++ b/src/sum.ts',
  '@@ -10,3 +10,3 @@ export const sum',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  ' return a + b;',
  '',
].join('\n');

const state = {
  branch: 'main',
  files: [
    {
      fingerprint: 'sum',
      path: 'src/sum.ts',
      sections: [{ binary: false, id: 'src/sum.ts:unstaged', kind: 'unstaged', patch }],
      status: 'modified',
    },
  ],
  root: '/repo',
  source: { type: 'working-tree' },
};

const createAgent = (response: unknown) => ({
  defaultTimeoutMs: 1000,
  isNotFoundError: () => false,
  label: 'Codex',
  notFoundCode: 'CODEX_NOT_FOUND',
  run: vi.fn(async () => JSON.stringify(response)),
});

test('numbers hunk lines by side for the agent', () => {
  const { input } = buildAgentReviewInput(state);

  expect(input.files[0]?.hunks[0]).toEqual({
    id: 'h1',
    lines: [
      ' 10 | const a = 1;',
      '-11 | const b = 2;',
      '+11 | const b = 3;',
      ' 12 | return a + b;',
    ].join('\n'),
  });
});

test('anchors agent comments to diff lines and drops unknown hunks', async () => {
  const agent = createAgent({
    comments: [
      { body: 'Why 3? (h1)', hunkId: 'h1', line: 11, severity: 'question', side: 'additions' },
      { body: 'Old value', hunkId: 'h1', line: 11, severity: 'nit', side: 'deletions' },
      { body: 'Off the hunk', hunkId: 'h1', line: 99, severity: 'issue', side: 'additions' },
      { body: 'Unknown hunk', hunkId: 'h9', line: 1, severity: 'issue', side: 'additions' },
      { body: '   ', hunkId: 'h1', line: 11, severity: 'issue', side: 'additions' },
    ],
    summary: 'One question.',
    version: 1,
  });

  const result = await readAgentReview(state, agent, {});

  expect(result).toEqual({
    comments: [
      {
        body: 'Why 3? (`src/sum.ts`)',
        filePath: 'src/sum.ts',
        lineNumber: 11,
        sectionId: 'src/sum.ts:unstaged',
        severity: 'question',
        side: 'additions',
      },
      {
        body: 'Old value',
        filePath: 'src/sum.ts',
        lineNumber: 11,
        sectionId: 'src/sum.ts:unstaged',
        severity: 'nit',
        side: 'deletions',
      },
      {
        body: 'Off the hunk',
        filePath: 'src/sum.ts',
        lineNumber: 11,
        sectionId: 'src/sum.ts:unstaged',
        severity: 'issue',
        side: 'deletions',
      },
    ],
    status: 'ready',
    summary: 'One question.',
  });
});

test('skips the agent when nothing is reviewable', async () => {
  const agent = createAgent({ comments: [], summary: '', version: 1 });

  const result = await readAgentReview({ ...state, files: [] }, agent, {});

  expect(result.status).toBe('ready');
  expect(result.comments).toEqual([]);
  expect(agent.run).not.toHaveBeenCalled();
});

test('reports agent failures as unavailable', async () => {
  const agent = {
    ...createAgent({}),
    run: vi.fn(async () => {
      throw new Error('boom');
    }),
  };

  expect(await readAgentReview(state, agent, {})).toEqual({
    reason: 'boom',
    status: 'unavailable',
  });
});
