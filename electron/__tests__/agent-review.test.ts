import { createRequire } from 'node:module';
import { expect, test, vi } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { buildAgentReviewInput, readAgentReview } = require('../agent-review.cjs') as {
  buildAgentReviewInput: (state: unknown) => { diff: string };
  readAgentReview: (
    state: unknown,
    agent: unknown,
    agentOptions: unknown,
    customPrompt?: string,
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

test('renders the diff as numbered lines under each file heading', () => {
  expect(buildAgentReviewInput(state).diff).toBe(
    [
      '=== src/sum.ts (modified) ===',
      '',
      '@@ -10,3 +10,3 @@ export const sum',
      ' 10 | const a = 1;',
      '-11 | const b = 2;',
      '+11 | const b = 3;',
      ' 12 | return a + b;',
    ].join('\n'),
  );
});

test('anchors comments by quoted line text and drops ones it cannot place', async () => {
  const comment = {
    body: 'Why 3?',
    line: 11,
    lineText: 'const b = 3;',
    path: 'src/sum.ts',
    severity: 'question',
    side: 'additions',
  };
  const agent = createAgent({
    comments: [
      comment,
      // Wrong number, right text: the text wins.
      { ...comment, body: 'Wrong number', line: 40, lineText: 'const   b = 2;', side: 'additions' },
      // Right number, paraphrased text: the number is kept.
      { ...comment, body: 'Paraphrased', lineText: 'b = three' },
      // Neither matches: dropped instead of guessed.
      { ...comment, body: 'Unplaceable', line: 99, lineText: 'nothing like this' },
      { ...comment, body: 'Unknown file', path: 'src/other.ts' },
      { ...comment, body: 'Prefixed path', path: 'b/src/sum.ts', severity: 'nit' },
      { ...comment, body: '   ' },
    ],
    summary: 'One question.',
    version: 1,
  });

  const result = await readAgentReview(state, agent, {});

  const placed = (body: string, lineNumber: number, side: string, severity = 'question') => ({
    body,
    filePath: 'src/sum.ts',
    lineNumber,
    sectionId: 'src/sum.ts:unstaged',
    severity,
    side,
  });
  expect(result).toEqual({
    comments: [
      placed('Why 3?', 11, 'additions'),
      placed('Wrong number', 11, 'deletions'),
      placed('Paraphrased', 11, 'additions'),
      placed('Prefixed path', 11, 'additions', 'nit'),
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

test('adds the reviewer prompt to the review instructions', async () => {
  const agent = createAgent({ comments: [], summary: '', version: 1 });

  await readAgentReview(state, agent, {});
  expect(agent.run.mock.calls[0]?.[1]).not.toContain('Custom review instructions');

  await readAgentReview(state, agent, {}, '  Focus on security.  ');
  const prompt = agent.run.mock.calls[1]?.[1] as string;
  expect(prompt).toContain('Custom review instructions from the reviewer:\nFocus on security.\n');
  expect(prompt.indexOf('Custom review instructions')).toBeLessThan(prompt.indexOf('Diff:'));
});
