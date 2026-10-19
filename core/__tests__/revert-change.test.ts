import { parseDiffFromFile, type SelectedLineRange } from '@pierre/diffs';
import { TextDocument, type RetainedDiffSessionSnapshot } from '@pierre/diffs/edit';
import { expect, test } from 'vite-plus/test';
import {
  getChangesInDocumentLines,
  getChangesInSelectedLines,
  getRevertChangeEdits,
} from '../lib/revert-change.ts';

const setup = (oldContents: string | null, newContents: string) => {
  const diff = parseDiffFromFile(
    { contents: oldContents ?? '', name: 'file.txt' },
    { contents: newContents, name: 'file.txt' },
  );
  const session: RetainedDiffSessionSnapshot = {
    hunks: diff.hunks,
    oldFile: oldContents == null ? null : { lines: diff.deletionLines, name: 'file.txt' },
    type: diff.type,
  };
  const document = new TextDocument('file.txt', newContents);
  const revert = (changes: ReturnType<typeof getChangesInSelectedLines>) => {
    document.applyEdits(getRevertChangeEdits(session, document, changes));
    return document.getText();
  };
  return {
    revertDocumentLines: (start: number, end = start) =>
      revert(getChangesInDocumentLines(session, [{ end, start }])),
    revertSelectedLines: (range: SelectedLineRange) =>
      revert(getChangesInSelectedLines(session, range)),
  };
};

const oldContents = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n';

test('reverts only the change block under the selected addition line', () => {
  const { revertSelectedLines } = setup(oldContents, oldContents.replace('b\n', 'B\nB2\n'));
  expect(revertSelectedLines({ end: 3, side: 'additions', start: 3 })).toBe(oldContents);
});

test('keeps other change blocks in the same file', () => {
  const newContents = oldContents.replace('b\n', 'B\n').replace('k\n', 'K\n');
  const { revertSelectedLines } = setup(oldContents, newContents);
  expect(revertSelectedLines({ end: 11, side: 'additions', start: 11 })).toBe(
    oldContents.replace('b\n', 'B\n'),
  );
});

test('restores removed lines from the deletion side', () => {
  const { revertSelectedLines } = setup(oldContents, oldContents.replace('d\ne\n', ''));
  expect(revertSelectedLines({ end: 5, side: 'deletions', start: 4 })).toBe(oldContents);
});

test('ignores unchanged lines', () => {
  const newContents = oldContents.replace('b\n', 'B\n');
  const { revertSelectedLines } = setup(oldContents, newContents);
  expect(revertSelectedLines({ end: 6, side: 'additions', start: 6 })).toBe(newContents);
});

test('reverts every change block in a range', () => {
  const newContents = oldContents.replace('b\n', 'B\n').replace('k\n', 'K\n');
  const { revertSelectedLines } = setup(oldContents, newContents);
  expect(revertSelectedLines({ end: 11, side: 'additions', start: 1 })).toBe(oldContents);
});

test('reverts changes at the end of a file without a trailing newline', () => {
  const { revertSelectedLines } = setup('a\nb\n', 'a\nb\nc');
  expect(revertSelectedLines({ end: 3, side: 'additions', start: 3 })).toBe('a\nb\n');

  const missingNewline = setup('a\nb', 'a\nB\n');
  expect(missingNewline.revertSelectedLines({ end: 2, side: 'additions', start: 2 })).toBe('a\nb');
});

test('reverts lines added to a new file', () => {
  const { revertSelectedLines } = setup(null, 'a\nb\n');
  expect(revertSelectedLines({ end: 1, side: 'additions', start: 1 })).toBe('');
});

test('a caret next to removed lines restores them', () => {
  const removed = oldContents.replace('d\ne\n', '');
  expect(setup(oldContents, removed).revertDocumentLines(3)).toBe(oldContents);
  expect(setup(oldContents, removed).revertDocumentLines(2)).toBe(oldContents);
  expect(setup(oldContents, removed).revertDocumentLines(0)).toBe(removed);
});
