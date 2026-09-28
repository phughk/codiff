import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';
import {
  createTemporaryDirectory,
  createTemporaryEnvironment,
} from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { submitPullRequestComment, submitPullRequestReview } =
  require('../git-state/pull-request.cjs') as {
    submitPullRequestComment: (
      launchPath: string,
      request: {
        comment: Record<string, unknown>;
        pending?: boolean;
        source: {
          provider: 'github';
          type: 'pull-request';
          url: string;
        };
      },
    ) => Promise<Record<string, unknown>>;
    submitPullRequestReview: (
      launchPath: string,
      request: {
        body?: string;
        comments: ReadonlyArray<Record<string, unknown>>;
        event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
        source: {
          provider: 'github';
          type: 'pull-request';
          url: string;
        };
      },
    ) => Promise<void>;
  };

const execFileAsync = promisify(execFile);

test('submits normalized GitHub review payloads through the GitHub CLI', async () => {
  await using directory = await createTemporaryDirectory('codiff-pull-request-review-');
  const repo = join(directory.path, 'repo');
  const fakeBin = join(directory.path, 'bin');
  const fakeGh = join(fakeBin, 'gh');
  const callsPath = join(directory.path, 'calls.jsonl');

  await Promise.all([mkdir(repo), mkdir(fakeBin)]);
  await execFileAsync('git', ['-C', repo, 'init']);
  await execFileAsync('git', [
    '-C',
    repo,
    'remote',
    'add',
    'origin',
    'git@github.com:nkzw-tech/codiff.git',
  ]);
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  appendFileSync(
    process.env.CODIFF_GITHUB_REVIEW_TEST_CALLS,
    JSON.stringify({ args, input }) + '\\n',
  );
  process.stdout.write(
    args.includes('repos/nkzw-tech/codiff/pulls/12')
      ? '{"head":{"sha":"0123456789abcdef0123456789abcdef01234567"}}'
      : '{}',
  );
});
`,
  );
  await chmod(fakeGh, 0o755);

  await using _environment = createTemporaryEnvironment({
    CODIFF_GITHUB_REVIEW_TEST_CALLS: callsPath,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    SHELL: undefined,
  });

  const source = {
    provider: 'github' as const,
    type: 'pull-request' as const,
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  };

  await submitPullRequestReview(repo, {
    comments: [
      {
        body: 'Please keep this explicit.',
        filePath: 'src/app.ts',
        lineNumber: 7,
        side: 'additions',
      },
    ],
    event: 'COMMENT',
    source,
  });
  await submitPullRequestReview(repo, {
    body: '  General feedback.  ',
    comments: [],
    event: 'COMMENT',
    source,
  });
  await expect(
    submitPullRequestReview(repo, {
      body: '   ',
      comments: [],
      event: 'COMMENT',
      source,
    }),
  ).rejects.toThrow('A comment review requires an inline comment or a review comment.');
  await submitPullRequestReview(repo, {
    comments: [],
    event: 'REQUEST_CHANGES',
    source,
  });

  const calls = (await readFile(callsPath, 'utf8'))
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          args: ReadonlyArray<string>;
          input: string;
        },
    );
  const reviewCalls = calls.filter((call) =>
    call.args.includes('repos/nkzw-tech/codiff/pulls/12/reviews'),
  );
  expect(reviewCalls).toHaveLength(3);
  expect(JSON.parse(reviewCalls[0].input)).toEqual({
    body: '',
    comments: [
      {
        body: 'Please keep this explicit.',
        line: 7,
        path: 'src/app.ts',
        side: 'RIGHT',
      },
    ],
    event: 'COMMENT',
  });
  expect(JSON.parse(reviewCalls[1].input)).toEqual({
    body: 'General feedback.',
    comments: [],
    event: 'COMMENT',
  });
  expect(JSON.parse(reviewCalls[2].input)).toEqual({
    body: 'Requesting changes.',
    comments: [],
    event: 'REQUEST_CHANGES',
  });
});

const createFakeGitHubRepository = async (directory: string) => {
  const repo = join(directory, 'repo');
  const fakeBin = join(directory, 'bin');
  const fakeGh = join(fakeBin, 'gh');
  const callsPath = join(directory, 'calls.jsonl');
  const pendingPath = join(directory, 'pending');

  await Promise.all([mkdir(repo), mkdir(fakeBin)]);
  await execFileAsync('git', ['-C', repo, 'init']);
  await execFileAsync('git', [
    '-C',
    repo,
    'remote',
    'add',
    'origin',
    'git@github.com:nkzw-tech/codiff.git',
  ]);
  // Mirrors GitHub: a review created without an event becomes the viewer's
  // pending review until it is submitted.
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, rmSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const pendingPath = process.env.CODIFF_GITHUB_REVIEW_TEST_PENDING;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  appendFileSync(
    process.env.CODIFF_GITHUB_REVIEW_TEST_CALLS,
    JSON.stringify({ args, input }) + '\\n',
  );
  const pending = { id: 5, node_id: 'PRR_5', state: 'PENDING' };
  const path = args.find((arg) => arg.startsWith('repos/') || arg === 'graphql');
  if (path === 'repos/nkzw-tech/codiff/pulls/12') {
    process.stdout.write('{"head":{"sha":"0123456789abcdef0123456789abcdef01234567"}}');
  } else if (path === 'repos/nkzw-tech/codiff/pulls/12/reviews?per_page=100') {
    process.stdout.write(JSON.stringify([existsSync(pendingPath) ? [pending] : []]));
  } else if (path === 'repos/nkzw-tech/codiff/pulls/12/reviews') {
    if (!JSON.parse(input).event) {
      writeFileSync(pendingPath, '');
    }
    process.stdout.write(JSON.stringify(pending));
  } else if (path === 'repos/nkzw-tech/codiff/pulls/12/reviews/5/events') {
    rmSync(pendingPath, { force: true });
    process.stdout.write('{}');
  } else if (path === 'graphql') {
    process.stdout.write(JSON.stringify({
      data: {
        addPullRequestReviewThread: {
          thread: {
            comments: {
              nodes: [{
                author: { avatarUrl: 'https://avatars.example/me', login: 'me', url: 'https://github.com/me' },
                body: JSON.parse(input).variables.input.body,
                createdAt: '2026-09-28T10:00:00Z',
                databaseId: 99,
                url: 'https://github.com/nkzw-tech/codiff/pull/12#discussion_r99',
              }],
            },
          },
        },
      },
    }));
  } else {
    process.stdout.write('{}');
  }
});
`,
  );
  await chmod(fakeGh, 0o755);

  const readCalls = async () =>
    (await readFile(callsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: ReadonlyArray<string>; input: string });

  return {
    environment: {
      CODIFF_GITHUB_REVIEW_TEST_CALLS: callsPath,
      CODIFF_GITHUB_REVIEW_TEST_PENDING: pendingPath,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      SHELL: undefined,
    },
    readCalls,
    repo,
  };
};

test('adds comments to a pending GitHub review and submits it', async () => {
  await using directory = await createTemporaryDirectory('codiff-pull-request-pending-');
  const { environment, readCalls, repo } = await createFakeGitHubRepository(directory.path);
  await using _environment = createTemporaryEnvironment(environment);

  const source = {
    provider: 'github' as const,
    type: 'pull-request' as const,
    url: 'https://github.com/nkzw-tech/codiff/pull/12',
  };

  const first = await submitPullRequestComment(repo, {
    comment: {
      body: 'First thought.',
      filePath: 'src/app.ts',
      lineNumber: 7,
      side: 'additions',
    },
    pending: true,
    source,
  });
  expect(first).toEqual({
    author: {
      avatarUrl: 'https://avatars.example/me',
      login: 'me',
      url: 'https://github.com/me',
    },
    body: 'First thought.',
    filePath: 'src/app.ts',
    id: 'github:99',
    isPending: true,
    lineNumber: 7,
    side: 'additions',
    submittedAt: '2026-09-28T10:00:00Z',
    url: 'https://github.com/nkzw-tech/codiff/pull/12#discussion_r99',
  });

  await submitPullRequestComment(repo, {
    comment: {
      body: 'Second thought.',
      filePath: 'src/app.ts',
      lineNumber: 4,
      side: 'deletions',
      startLineNumber: 2,
    },
    pending: true,
    source,
  });

  await submitPullRequestReview(repo, {
    comments: [
      {
        body: 'Unsent draft.',
        filePath: 'src/other.ts',
        lineNumber: 1,
        side: 'additions',
      },
    ],
    event: 'COMMENT',
    source,
  });

  const calls = await readCalls();
  // Only the first pending comment creates the review.
  const createCalls = calls.filter((call) =>
    call.args.includes('repos/nkzw-tech/codiff/pulls/12/reviews'),
  );
  expect(createCalls).toHaveLength(1);
  expect(JSON.parse(createCalls[0].input)).toEqual({
    commit_id: '0123456789abcdef0123456789abcdef01234567',
  });

  const threadInputs = calls
    .filter((call) => call.args.includes('graphql'))
    .map((call) => JSON.parse(call.input).variables.input);
  expect(threadInputs).toEqual([
    {
      body: 'First thought.',
      line: 7,
      path: 'src/app.ts',
      pullRequestReviewId: 'PRR_5',
      side: 'RIGHT',
    },
    {
      body: 'Second thought.',
      line: 4,
      path: 'src/app.ts',
      pullRequestReviewId: 'PRR_5',
      side: 'LEFT',
      startLine: 2,
      startSide: 'LEFT',
    },
    {
      body: 'Unsent draft.',
      line: 1,
      path: 'src/other.ts',
      pullRequestReviewId: 'PRR_5',
      side: 'RIGHT',
    },
  ]);

  const eventCalls = calls.filter((call) =>
    call.args.includes('repos/nkzw-tech/codiff/pulls/12/reviews/5/events'),
  );
  expect(eventCalls).toHaveLength(1);
  expect(JSON.parse(eventCalls[0].input)).toEqual({ event: 'COMMENT' });
});
