import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

type AgentActivity = { detail?: string; kind: string; label: string };

const require = createRequire(import.meta.url);
const { describeCommand, describeToolUse } = require('../agent-activity.cjs') as {
  describeCommand: (command: string, root?: string) => AgentActivity;
  describeToolUse: (name: string, input: unknown, root?: string) => AgentActivity;
};

test('describes file tools with paths relative to the workspace', () => {
  expect(describeToolUse('Read', { file_path: '/repo/src/a.ts' }, '/repo')).toEqual({
    kind: 'read',
    label: 'Read src/a.ts',
  });
  expect(describeToolUse('Read', { file_path: '/elsewhere/b.ts' }, '/repo')).toEqual({
    kind: 'read',
    label: 'Read /elsewhere/b.ts',
  });
  expect(describeToolUse('Glob', { pattern: '**/*.test.ts' }, '/repo')).toEqual({
    kind: 'list',
    label: 'Found files matching `**/*.test.ts`',
  });
  expect(describeToolUse('WebFetch', { url: 'https://example.com' }, '/repo')).toEqual({
    kind: 'other',
    label: 'Used WebFetch',
  });
});

test('classifies shell commands and unwraps Codex shells', () => {
  expect(describeCommand("/bin/zsh -lc 'git blame -L 10,20 /repo/src/a.ts'", '/repo')).toEqual({
    detail: 'git blame -L 10,20 src/a.ts',
    kind: 'history',
    label: 'Checked git blame',
  });
  expect(describeCommand('git grep -n parse', '/repo')).toMatchObject({ kind: 'search' });
  expect(describeCommand("sg --pattern 'syncState($$$)' --lang ts", '/repo')).toMatchObject({
    kind: 'search',
    label: 'Searched the syntax tree',
  });
  expect(describeCommand('ls -la src', '/repo')).toMatchObject({ kind: 'list' });
  expect(describeCommand('node -e 1', '/repo')).toMatchObject({ kind: 'command' });
  expect(describeCommand(`rg ${'x'.repeat(400)}`).detail?.length).toBeLessThanOrEqual(160);
});
