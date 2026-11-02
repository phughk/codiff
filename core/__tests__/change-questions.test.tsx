/**
 * @vitest-environment jsdom
 */

import { act, useRef } from 'react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { useChangeQuestions } from '../app/hooks/useChangeQuestions.ts';
import { getSourceKey } from '../lib/source.ts';
import type { RepositoryState } from '../types.ts';
import { renderReact, waitFor } from './helpers/react.tsx';

type ChangeQuestions = ReturnType<typeof useChangeQuestions>;
type ActivityListener = Parameters<NonNullable<Window['codiff']['onReviewAssistantActivity']>>[0];

const originalCodiff = window.codiff;
const state = {
  branch: 'main',
  files: [],
  generatedAt: 1,
  launchPath: '/repo',
  root: '/repo',
  source: {
    number: 42,
    owner: 'nkzw-tech',
    provider: 'github',
    repo: 'codiff',
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/42',
  },
} satisfies RepositoryState;
const sourceKey = getSourceKey(state.source);

function Harness({ onState }: { onState: (questions: ChangeQuestions) => void }) {
  const stateRef = useRef<RepositoryState | null>(state);
  onState(useChangeQuestions(stateRef));
  return null;
}

afterEach(() => {
  window.codiff = originalCodiff;
});

test('asks about the whole change, streams steps, and sends follow-ups with history', async () => {
  let listener: ActivityListener | null = null;
  const replies = [
    Promise.withResolvers<{ reply: string; status: 'ready' }>(),
    Promise.withResolvers<{ reply: string; status: 'ready' }>(),
  ];
  const askReviewAssistant = vi.fn(
    (_request: unknown) => replies[askReviewAssistant.mock.calls.length - 1]!.promise,
  );
  window.codiff = {
    askReviewAssistant,
    onReviewAssistantActivity: (callback: ActivityListener) => {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  } as unknown as Window['codiff'];

  const ref: { current: ChangeQuestions | null } = { current: null };
  await using _view = await renderReact(<Harness onState={(value) => (ref.current = value)} />);
  const get = () => ref.current!;

  await act(async () => {
    get().ask('  Who calls syncState?  ');
  });
  const first = askReviewAssistant.mock.calls[0]![0] as { requestId: string };
  expect(first).toMatchObject({ question: 'Who calls syncState?', source: state.source });
  expect(first).not.toHaveProperty('comment');
  expect(first).not.toHaveProperty('followUp');

  await act(async () => {
    listener?.({ activity: { kind: 'search', label: 'Searched' }, requestId: 'other' });
    listener?.({
      activity: { kind: 'search', label: 'Searched for `syncState`' },
      requestId: first.requestId,
    });
  });
  expect(get().getTurns(sourceKey)).toMatchObject([
    {
      activity: [{ label: 'Searched for `syncState`' }],
      question: 'Who calls syncState?',
      status: 'loading',
    },
  ]);

  // A second question waits for the first answer.
  await act(async () => {
    get().ask('Ignored while busy');
  });
  expect(askReviewAssistant).toHaveBeenCalledTimes(1);

  await act(async () => {
    replies[0]!.resolve({ reply: 'The worker calls it.', status: 'ready' });
  });
  await waitFor(() => expect(get().getTurns(sourceKey)[0]?.status).toBe('ready'));
  expect(get().getTurns(sourceKey)[0]).toMatchObject({
    activity: [{ label: 'Searched for `syncState`' }],
    reply: 'The worker calls it.',
  });

  await act(async () => {
    get().ask('And on shutdown?');
  });
  expect(askReviewAssistant.mock.calls[1]![0]).toMatchObject({
    conversation: [{ body: 'The worker calls it.', role: 'agent' }],
    followUp: 'And on shutdown?',
    question: 'Who calls syncState?',
  });
  await act(async () => {
    replies[1]!.resolve({ reply: 'No.', status: 'ready' });
  });
  await waitFor(() => expect(get().getTurns(sourceKey)).toHaveLength(2));
  await waitFor(() => expect(get().getTurns(sourceKey)[1]?.status).toBe('ready'));

  expect(get().getTurns('another-source')).toEqual([]);
  await act(async () => {
    get().clear();
  });
  expect(get().getTurns(sourceKey)).toEqual([]);
});
