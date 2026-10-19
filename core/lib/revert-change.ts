import type { ChangeContent, SelectedLineRange, SelectionSide } from '@pierre/diffs';
import type { RetainedDiffSessionSnapshot, TextDocument, TextEdit } from '@pierre/diffs/edit';

type LineRange = { end: number; side: SelectionSide; start: number };

const getChangeBlocks = (session: RetainedDiffSessionSnapshot) =>
  session.hunks.flatMap((hunk) =>
    hunk.hunkContent.filter((content): content is ChangeContent => content.type === 'change'),
  );

const overlaps = (start: number, count: number, range: { end: number; start: number }) =>
  count > 0 && start <= range.end && range.start < start + count;

// Zero-based, inclusive line indexes on one side of the diff.
const containsRange = (change: ChangeContent, { end, side, start }: LineRange) =>
  side === 'additions'
    ? overlaps(change.additionLineIndex, change.additions, { end, start })
    : overlaps(change.deletionLineIndex, change.deletions, { end, start });

export const getChangesInSelectedLines = (
  session: RetainedDiffSessionSnapshot,
  range: SelectedLineRange,
) => {
  const side = range.side ?? 'additions';
  const endSide = range.endSide ?? side;
  const start = Math.min(range.start, range.end) - 1;
  const end = Math.max(range.start, range.end) - 1;
  // A split-view range can cross sides; their line numbers are not comparable,
  // so only revert changes under either endpoint.
  const ranges: ReadonlyArray<LineRange> =
    side === endSide
      ? [{ end, side, start }]
      : [
          { end: range.start - 1, side, start: range.start - 1 },
          { end: range.end - 1, side: endSide, start: range.end - 1 },
        ];
  return getChangeBlocks(session).filter((change) =>
    ranges.some((lineRange) => containsRange(change, lineRange)),
  );
};

// Editor selections use zero-based document lines, which are the addition side.
// A caret next to removed lines also selects that deletion.
export const getChangesInDocumentLines = (
  session: RetainedDiffSessionSnapshot,
  ranges: ReadonlyArray<{ end: number; start: number }>,
) =>
  getChangeBlocks(session).filter((change) =>
    ranges.some((range) =>
      change.additions > 0
        ? overlaps(change.additionLineIndex, change.additions, range)
        : change.additionLineIndex >= range.start && change.additionLineIndex <= range.end + 1,
    ),
  );

const getLineOffset = (document: TextDocument, line: number) =>
  line >= document.lineCount
    ? document.getText().length
    : document.offsetAt({ character: 0, line });

export const getRevertChangeEdits = (
  session: RetainedDiffSessionSnapshot,
  document: TextDocument,
  changes: ReadonlyArray<ChangeContent>,
): Array<TextEdit> => {
  const oldLines = session.oldFile?.lines ?? [];
  return changes.map((change) => {
    const start = getLineOffset(document, change.additionLineIndex);
    const end = getLineOffset(document, change.additionLineIndex + change.additions);
    return {
      newText: document.normalizeEol(
        oldLines
          .slice(change.deletionLineIndex, change.deletionLineIndex + change.deletions)
          .join(''),
      ),
      range: { end: document.positionAt(end), start: document.positionAt(start) },
    };
  });
};
