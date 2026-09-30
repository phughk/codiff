/**
 * @vitest-environment jsdom
 */

import { expect, test, vi } from 'vite-plus/test';
import {
  GraphvizDiffPreview,
  renderGraphviz,
  sanitizeGraphSvg,
} from '../app/components/GraphvizDiffPreview.tsx';
import {
  getGraphvizPreviewContents,
  getVisibleDiffSections,
  isGraphvizFilePath,
} from '../lib/diff.ts';
import type { ChangedFile } from '../types.ts';
import { renderReact, waitFor } from './helpers/react.tsx';

const createDotFile = (status: ChangedFile['status'], oldContents: string, newContents: string) =>
  ({
    fingerprint: 'graph.dot:1',
    path: 'graph.dot',
    sections: [
      {
        binary: false,
        id: 'graph.dot:unstaged',
        kind: 'unstaged',
        loadState: 'ready',
        ...(status === 'added' ? {} : { oldFile: { contents: oldContents, name: 'graph.dot' } }),
        ...(status === 'deleted' ? {} : { newFile: { contents: newContents, name: 'graph.dot' } }),
        patch:
          'diff --git a/graph.dot b/graph.dot\n@@ -1 +1 @@\n-digraph { a }\n+digraph { a -> b }\n',
      },
    ],
    status,
  }) satisfies ChangedFile;

test('recognizes Graphviz file extensions', () => {
  expect(isGraphvizFilePath('docs/flow.dot')).toBe(true);
  expect(isGraphvizFilePath('docs/flow.GV')).toBe(true);
  expect(isGraphvizFilePath('docs/flow.md')).toBe(false);
});

test('reads the DOT source before and after a change', () => {
  const file = createDotFile('modified', 'digraph { a }', 'digraph { a -> b }');
  const [{ fileDiff, section }] = getVisibleDiffSections(file, false);

  expect(getGraphvizPreviewContents(file, section, fileDiff)).toEqual({
    after: 'digraph { a -> b }',
    before: 'digraph { a }',
  });
  const added = createDotFile('added', '', 'digraph { a -> b }');
  const [addedSection] = getVisibleDiffSections(added, false);
  expect(getGraphvizPreviewContents(added, addedSection.section, addedSection.fileDiff)).toEqual({
    after: 'digraph { a -> b }',
    before: null,
  });
});

test('has no graph preview until a modified file has both sides loaded', () => {
  const file = {
    ...createDotFile('modified', '', ''),
    sections: [
      {
        binary: false,
        id: 'graph.dot:pull-request',
        kind: 'pull-request',
        loadState: 'ready',
        patch:
          'diff --git a/graph.dot b/graph.dot\n@@ -1 +1 @@\n-digraph { a }\n+digraph { a -> b }\n',
      },
    ],
  } satisfies ChangedFile;
  const [{ fileDiff, section }] = getVisibleDiffSections(file, false);

  expect(getGraphvizPreviewContents(file, section, fileDiff)).toBeNull();
});

test('strips links and scripts from rendered graphs', () => {
  const svg = sanitizeGraphSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(1)</script><a xlink:href="https://example.com" href="javascript:alert(1)"><text>node</text></a></svg>',
  );

  expect(svg).toContain('<text>node</text>');
  expect(svg).not.toContain('script');
  expect(svg).not.toContain('href');
  expect(svg).not.toContain('onload');
});

test('renders DOT source to SVG and reports syntax errors', async () => {
  const svg = await renderGraphviz('digraph { a -> b [URL="https://example.com"] }');
  expect(svg).toMatch(/^<svg[\s\S]*<title>a-&gt;b<\/title>/);
  expect(svg).not.toContain('example.com');
  await expect(renderGraphviz('digraph {')).rejects.toThrow(/syntax error/i);
});

test('shows before and after panes for a changed graph', async () => {
  const onLayoutReady = vi.fn();
  await using view = await renderReact(
    <GraphvizDiffPreview
      after="digraph { a -> b }"
      before={null}
      onLayoutReady={onLayoutReady}
      sectionId="graph.dot:unstaged"
    />,
  );

  expect(view.container.querySelector('[data-side="before"]')?.textContent).toContain(
    'File did not exist',
  );
  await waitFor(() =>
    expect(view.container.querySelector('[data-side="after"] svg')).not.toBeNull(),
  );
  expect(onLayoutReady).toHaveBeenCalledWith('graph.dot:unstaged');
});
