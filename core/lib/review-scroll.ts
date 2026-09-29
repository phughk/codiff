import type { ChangedFile } from '../types.ts';
import type { CodeViewInstance } from './app-types.ts';
import { DEFAULT_PADDING } from './code-view-options.ts';
import { getFirstVisibleSection, getItemId } from './diff.ts';

type ReviewScrollViewer = Pick<CodeViewInstance, 'getScrollTop' | 'getTopForItem'>;

export const getSelectedPathFromScroll = (
  viewer: ReviewScrollViewer,
  files: ReadonlyArray<ChangedFile>,
  showWhitespace: boolean,
) => {
  const firstFile = files[0];
  if (!firstFile) {
    return null;
  }

  const activationTop = viewer.getScrollTop() + DEFAULT_PADDING;
  let nextPath = firstFile.path;
  let nextDistance = Number.NEGATIVE_INFINITY;

  for (const file of files) {
    const section = getFirstVisibleSection(file, showWhitespace);
    const itemTop = section ? viewer.getTopForItem(getItemId(section)) : undefined;
    if (itemTop == null) {
      continue;
    }

    const distance = itemTop - activationTop;
    if (distance <= 0 && distance > nextDistance) {
      nextDistance = distance;
      nextPath = file.path;
    }
  }

  return nextPath;
};

export type ScrollLineProgress = {
  left: number;
  /** 0 at the top of the scroll range, 1 at the bottom. */
  position: number;
  read: number;
};

/**
 * Splits the diff's changed lines into those above the bottom of the viewport
 * (read) and those below it (left). Within the item the viewport edge falls
 * in, lines are counted in proportion to how much of the item is above it.
 */
export const getScrollLineProgress = (
  viewer: Pick<
    CodeViewInstance,
    'getHeight' | 'getScrollHeight' | 'getScrollTop' | 'getTopForItem'
  >,
  items: ReadonlyArray<{ id: string; lineCount: number }>,
): ScrollLineProgress => {
  const scrollTop = viewer.getScrollTop();
  const height = viewer.getHeight();
  const scrollHeight = viewer.getScrollHeight();
  const bottom = scrollTop + height;
  const scrollRange = scrollHeight - height;

  let read = 0;
  let total = 0;
  for (const [index, item] of items.entries()) {
    total += item.lineCount;
    const top = viewer.getTopForItem(item.id);
    if (top == null || top >= bottom) {
      continue;
    }
    const nextItem = items[index + 1];
    const end = (nextItem ? viewer.getTopForItem(nextItem.id) : undefined) ?? scrollHeight;
    read +=
      end <= bottom || end <= top
        ? item.lineCount
        : (item.lineCount * (bottom - top)) / (end - top);
  }

  const roundedRead = Math.min(total, Math.round(read));
  return {
    left: total - roundedRead,
    position: scrollRange > 0 ? Math.min(1, Math.max(0, scrollTop / scrollRange)) : 0,
    read: roundedRead,
  };
};
