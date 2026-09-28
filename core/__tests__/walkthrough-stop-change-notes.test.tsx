/**
 * @vitest-environment jsdom
 */

import { expect, test } from 'vite-plus/test';
import { StopChangeNotes } from '../app/components/walkthrough/parts.tsx';
import { renderReact } from './helpers/react.tsx';

test('renders why, before, and after notes in order and skips missing ones', async () => {
  await using view = await renderReact(
    <StopChangeNotes
      stop={{
        after: 'Reuses the in-flight `submit` request.',
        before: 'Each click started a new request.',
      }}
    />,
  );

  const rows = [...view.container.querySelectorAll('.wt-change-note')].map((row) => [
    row.querySelector('dt')?.textContent,
    row.querySelector('dd')?.textContent,
  ]);
  expect(rows).toEqual([
    ['Before', 'Each click started a new request.'],
    ['After', 'Reuses the in-flight submit request.'],
  ]);
  expect(view.container.querySelector('.wt-change-note.after code')?.textContent).toBe('submit');
});

test('renders nothing for stops without notes', async () => {
  await using view = await renderReact(<StopChangeNotes stop={{}} />);
  expect(view.container.querySelector('.wt-change-notes')).toBeNull();
});
