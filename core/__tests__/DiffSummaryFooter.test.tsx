/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { DiffSummaryFooter } from '../app/components/DiffSummaryFooter.tsx';
import { createChangedFile } from './helpers/fixtures.ts';
import { renderReact } from './helpers/react.tsx';

beforeEach(() => localStorage.clear());

const files = [
  createChangedFile('src/app.ts'),
  createChangedFile('tests/app.ts'),
  createChangedFile('README.md'),
];

test('shows three categories by default and remembers collapse across mounts', async () => {
  {
    await using app = await renderReact(<DiffSummaryFooter files={files} showWhitespace={false} />);
    expect([...app.container.querySelectorAll('dt')].map((cell) => cell.textContent)).toEqual([
      'Prod',
      'Tests',
      'Other',
    ]);
    expect(app.container.querySelector('.sidebar-total-line-count')?.textContent).toBe('+3-3');
    const toggle = app.container.querySelector<HTMLButtonElement>('.sidebar-total-summary')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.querySelector('.summary-chevron.expanded')).not.toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(app.container.querySelector('.sidebar-summary-breakdown')).toBeNull();
    expect(toggle.querySelector('.summary-chevron.expanded')).toBeNull();
    expect(app.container.querySelector('.sidebar-total-line-count')?.textContent).toBe('+3-3');
  }
  await using app = await renderReact(<DiffSummaryFooter files={files} showWhitespace={false} />);
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBeNull();
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>('.sidebar-total-summary')!.click(),
  );
  expect(app.container.querySelectorAll('.sidebar-summary-breakdown > div')).toHaveLength(3);
});

test('keeps the expanded breakdown mounted while switching sources and clears stale counts', async () => {
  await using app = await renderReact(<DiffSummaryFooter files={files} showWhitespace={false} />);
  const breakdown = app.container.querySelector('.sidebar-summary-breakdown');
  await app.rerender(<DiffSummaryFooter files={files} loading showWhitespace={false} />);
  expect(app.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(app.container.querySelector('.sidebar-total-line-count')).toBeNull();
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBe(breakdown);
  expect(app.container.querySelector('.sidebar-total-summary')?.getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(
    [...app.container.querySelectorAll('.sidebar-summary-breakdown > div')].map(
      (row) => row.textContent,
    ),
  ).toEqual(['Prod——', 'Tests——', 'Other——']);
  expect(app.container.querySelector('.sidebar-total-summary')?.textContent).toBe('Total:—');
  await app.rerender(<DiffSummaryFooter files={[]} showWhitespace={false} />);
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBe(breakdown);
  expect(app.container.querySelector<HTMLButtonElement>('.sidebar-total-summary')?.disabled).toBe(
    false,
  );
  await app.rerender(<DiffSummaryFooter files={[files[0]]} showWhitespace={false} />);
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBe(breakdown);
  expect(app.container.querySelector('.sidebar-total-line-count')?.textContent).toBe('+1-1');
  await act(async () =>
    app.container.querySelector<HTMLButtonElement>('.sidebar-total-summary')!.click(),
  );
  await app.rerender(<DiffSummaryFooter files={files} loading showWhitespace={false} />);
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBeNull();
  await app.rerender(<DiffSummaryFooter files={files} showWhitespace={false} />);
  expect(app.container.querySelector('.sidebar-summary-breakdown')).toBeNull();
});

test('collapse still works if browser storage is unavailable', async () => {
  const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  try {
    await using app = await renderReact(<DiffSummaryFooter files={files} showWhitespace={false} />);
    await act(async () =>
      app.container.querySelector<HTMLButtonElement>('.sidebar-total-summary')!.click(),
    );
    expect(app.container.querySelector('.sidebar-summary-breakdown')).toBeNull();
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
  }
});
