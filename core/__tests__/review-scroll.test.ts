import { expect, test, vi } from 'vite-plus/test';
import { getScrollLineProgress, getSelectedPathFromScroll } from '../lib/review-scroll.ts';
import { createChangedFile } from './helpers/fixtures.ts';

const firstFile = createChangedFile('src/first.ts');
const secondFile = createChangedFile('src/second.ts');
const thirdFile = createChangedFile('src/third.ts');
const files = [firstFile, secondFile, thirdFile];

const createViewer = (scrollTop: number, itemTops: Readonly<Record<string, number>>) => ({
  getScrollTop: () => scrollTop,
  getTopForItem: (itemId: string) => itemTops[itemId],
});

test('selected path from scroll returns null without visible files', () => {
  const viewer = createViewer(0, {});

  expect(getSelectedPathFromScroll(viewer, [], false)).toBeNull();
});

test('selected path from scroll uses the closest file above the activation point', () => {
  const viewer = createViewer(210, {
    'diff:src/first.ts:unstaged': 20,
    'diff:src/second.ts:unstaged': 220,
    'diff:src/third.ts:unstaged': 420,
  });

  expect(getSelectedPathFromScroll(viewer, files, false)).toBe(secondFile.path);
});

test('selected path from scroll falls back to the first file before measured content', () => {
  const viewer = createViewer(0, {
    'diff:src/first.ts:unstaged': 20,
    'diff:src/second.ts:unstaged': 220,
  });

  expect(getSelectedPathFromScroll(viewer, files, false)).toBe(firstFile.path);
});

test('selected path from scroll ignores files without measured positions', () => {
  const getTopForItem = vi.fn((itemId: string) =>
    itemId === 'diff:src/third.ts:unstaged' ? 400 : undefined,
  );
  const viewer = {
    getScrollTop: () => 500,
    getTopForItem,
  };

  expect(getSelectedPathFromScroll(viewer, files, false)).toBe(thirdFile.path);
  expect(getTopForItem).toHaveBeenCalledTimes(3);
});

test('splits changed lines at the bottom of the viewport', () => {
  // Items: a (0-100, 10 lines), b (100-300, 40 lines), c (300-400, 6 lines).
  const tops: Record<string, number> = { a: 0, b: 100, c: 300 };
  const items = [
    { id: 'a', lineCount: 10 },
    { id: 'b', lineCount: 40 },
    { id: 'c', lineCount: 6 },
  ];
  const viewerAt = (scrollTop: number) => ({
    getHeight: () => 100,
    getScrollHeight: () => 400,
    getScrollTop: () => scrollTop,
    getTopForItem: (id: string) => tops[id],
  });

  expect(getScrollLineProgress(viewerAt(0), items)).toEqual({ left: 46, position: 0, read: 10 });
  // The bottom edge is halfway through b.
  expect(getScrollLineProgress(viewerAt(100), items)).toEqual({
    left: 26,
    position: 1 / 3,
    read: 30,
  });
  expect(getScrollLineProgress(viewerAt(300), items)).toEqual({ left: 0, position: 1, read: 56 });
});
