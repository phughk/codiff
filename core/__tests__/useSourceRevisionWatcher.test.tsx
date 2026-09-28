/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { useSourceRevisionWatcher } from '../app/hooks/useSourceRevisionWatcher.ts';
import type { RepositoryState } from '../types.ts';
import { renderReact } from './helpers/react.tsx';

function Harness({
  onChange,
  state,
}: {
  onChange: (changed: boolean) => void;
  state: RepositoryState;
}) {
  onChange(useSourceRevisionWatcher(state, false));
  return null;
}

const createState = (
  revision: string,
  source: RepositoryState['source'] = {
    baseRef: 'base',
    headRef: 'head',
    ref: 'main',
    type: 'branch-diff',
  },
): RepositoryState => ({
  branch: 'feature',
  files: [],
  generatedAt: 0,
  launchPath: '/repo',
  revision,
  root: '/repo',
  source,
});

let currentRevision = 'base..head';
const getSourceRevision = vi.fn(async () => currentRevision);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  currentRevision = 'base..head';
  getSourceRevision.mockClear();
  window.codiff = { getSourceRevision } as unknown as Window['codiff'];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });

test('reports a moved branch comparison until a refresh loads the new revision', async () => {
  let changed = false;
  const onChange = (value: boolean) => {
    changed = value;
  };
  await using view = await renderReact(
    <Harness onChange={onChange} state={createState('base..head')} />,
  );

  await advance();
  expect(getSourceRevision).toHaveBeenCalled();
  expect(changed).toBe(false);

  currentRevision = 'base..next';
  await advance();
  expect(changed).toBe(true);

  await view.rerender(<Harness onChange={onChange} state={createState('base..next')} />);
  expect(changed).toBe(false);
});

test('does not poll sources whose refs cannot move', async () => {
  let changed = false;
  await using _view = await renderReact(
    <Harness
      onChange={(value) => {
        changed = value;
      }}
      state={createState('parent..commit', { ref: 'commit', type: 'commit' })}
    />,
  );

  currentRevision = 'other';
  await advance();
  expect(getSourceRevision).not.toHaveBeenCalled();
  expect(changed).toBe(false);
});
