/** @vitest-environment jsdom */
import { act } from 'react';
import { expect, test, vi } from 'vite-plus/test';
import { MarkdownDiffView } from '../app/components/MarkdownDiffView.tsx';
import { getMarkdownChanges, groupMarkdownChanges } from '../lib/markdown-diff.ts';
import { renderReact } from './helpers/react.tsx';

test('renders word changes inside formatted prose without repeating the paragraph', async () => {
  await using view = await renderReact(
    <MarkdownDiffView
      newContents="Links expire after **30 days**."
      oldContents="Links expire after **7 days**."
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  expect(view.container.querySelectorAll('p')).toHaveLength(1);
  expect(view.container.querySelector('strong del')?.textContent).toBe('7');
  expect(view.container.querySelector('strong ins')?.textContent).toBe('30');
  expect(view.container.querySelector('strong')?.textContent).toBe('730 days');
});

test('keeps deletion-only edits visible and links to the old source line', async () => {
  const onViewSource = vi.fn();
  await using view = await renderReact(
    <MarkdownDiffView
      newContents={'# Sharing\n\nKeep this.\n'}
      oldContents={'# Sharing\n\nKeep this.\n\nRemove this paragraph.\n'}
      onViewSource={onViewSource}
      path="README.md"
    />,
  );
  expect(view.container.innerHTML).toContain('Remove this paragraph.');
  expect(view.container.querySelector('.removed p')?.textContent).toBe('Remove this paragraph.');
  expect(view.container.querySelector('.removed .codiff-markdown-after')).toBeNull();
  await act(async () =>
    view.container.querySelector<HTMLButtonElement>('.removed button')?.click(),
  );
  expect(onViewSource).toHaveBeenCalledWith(5, 'deletions');
});

test('collapses distant context while keeping the enclosing heading and nearby prose', async () => {
  const before =
    '# Intro\n\nOne.\n\nTwo.\n\nThree.\n\n## Sharing\n\nContext.\n\nOld.\n\nAfter.\n\nDistant.\n';
  const changes = getMarkdownChanges(before, before.replace('Old.', 'New.'));
  const groups = groupMarkdownChanges(changes);
  expect(groups.filter((group) => group.collapsed).map((group) => group.changes.length)).toEqual([
    4, 1,
  ]);
  await using view = await renderReact(
    <MarkdownDiffView
      newContents={before.replace('Old.', 'New.')}
      oldContents={before}
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  expect(view.container.querySelector('details')?.open).toBe(false);
  expect(view.container.querySelector('h2')?.closest('details')).toBeNull();
  expect(view.container.querySelector('.modified')?.closest('details')).toBeNull();
});

test.each([
  ['[Guide](/old)', '[Guide](/new)', 'Link destination', '/old', '/new'],
  [
    '![Plan](https://example.com/old.png)',
    '![Plan](https://example.com/new.png)',
    'Image source',
    'https://example.com/old.png',
    'https://example.com/new.png',
  ],
  [
    '[Guide][docs]\n\n[docs]: /old',
    '[Guide][docs]\n\n[docs]: /new',
    'Link destination',
    '/old',
    '/new',
  ],
])(
  'exposes otherwise invisible attributes in %s',
  async (oldContents, newContents, label, before, after) => {
    await using view = await renderReact(
      <MarkdownDiffView
        newContents={newContents}
        oldContents={oldContents}
        onViewSource={vi.fn()}
        path="README.md"
      />,
    );
    const change = view.container.querySelector('.codiff-markdown-attribute-change');
    expect(change?.textContent).toContain(label);
    expect(change?.querySelector('del')?.textContent).toBe(before);
    expect(change?.querySelector('ins')?.textContent).toBe(after);
  },
);

test.each([
  ['**Same**', '__Same__'],
  ['# Title\n\nText.\n', '# Title\n\n\nText.\n'],
  ['# Title\n', '# Title'],
])(
  'preserves syntax-only changes without inventing prose additions: %s',
  async (oldContents, newContents) => {
    await using view = await renderReact(
      <MarkdownDiffView
        newContents={newContents}
        oldContents={oldContents}
        onViewSource={vi.fn()}
        path="README.md"
      />,
    );
    expect(
      view.container.querySelector('.codiff-markdown-source-change summary')?.textContent,
    ).toBe('Markdown syntax changed');
    expect(
      view.container.querySelector(
        '.codiff-markdown-source-change .added, .codiff-markdown-source-change .removed',
      ),
    ).not.toBeNull();
    expect(view.container.querySelector('.codiff-markdown-change.added')).toBeNull();
  },
);

test('renders complete tables, nested task lists, and code fences across edits', async () => {
  const before =
    '| Setting | Value |\n| --- | --- |\n| Days | 7 |\n\n- [ ] Review\n  - Nested item\n\n```ts\nconst days = 7;\n```\n';
  await using view = await renderReact(
    <MarkdownDiffView
      newContents={before.replaceAll('7', '30')}
      oldContents={before}
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  expect(view.container.querySelectorAll('table')).toHaveLength(1);
  expect(view.container.querySelector('td del')?.textContent).toBe('7');
  expect(view.container.querySelector('td ins')?.textContent).toBe('30');
  expect(view.container.querySelector('ul ul li')?.textContent).toBe('Nested item');
  expect(view.container.querySelector('input')?.disabled).toBe(true);
  expect(view.container.querySelector('pre code ins')?.textContent).toBe('30');
});

test('preserves structural formatting changes as before and after blocks', async () => {
  await using view = await renderReact(
    <MarkdownDiffView
      newContents="Use **caution**."
      oldContents="Use caution."
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  expect(view.container.querySelector('.codiff-markdown-before p')?.textContent).toBe(
    'Use caution.',
  );
  expect(view.container.querySelector('.codiff-markdown-after strong')?.textContent).toBe(
    'caution',
  );
});

test('shows frontmatter and HTML changes as literal source and rejects executable links', async () => {
  const before =
    '---\ntitle: Old\n---\n\n<script>alert(1)</script>\n\n[Click](javascript:alert%281%29)';
  await using view = await renderReact(
    <MarkdownDiffView
      newContents={before.replaceAll('Old', 'New').replaceAll('alert', 'confirm')}
      oldContents={before}
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.container.querySelector('.codiff-markdown-literal')?.textContent).toContain('title:');
  expect(view.container.querySelector('.codiff-markdown-literal ins')?.textContent).toBe('New');
  expect(
    [...view.container.querySelectorAll('a')].every((link) => !link.hasAttribute('href')),
  ).toBe(true);
});

test('bounds alignment work without dropping wholly replaced documents', () => {
  const before = Array.from({ length: 600 }, (_, index) => `Old paragraph ${index}.`).join('\n\n');
  const after = Array.from({ length: 600 }, (_, index) => `New paragraph ${index}.`).join('\n\n');
  const changes = getMarkdownChanges(before, after);
  expect(changes).toHaveLength(600);
  expect(changes.every((change) => change.kind === 'modified')).toBe(true);
  expect(changes.at(-1)?.after?.source).toBe('New paragraph 599.');
});

test('keeps existing strikethrough and inline HTML distinct from review deletions', async () => {
  await using view = await renderReact(
    <MarkdownDiffView
      newContents={'Keep ~~retired~~ and <b>literal</b>.\n\nNew.'}
      oldContents={'Keep ~~retired~~ and <b>literal</b>.\n\nOld.'}
      onViewSource={vi.fn()}
      path="README.md"
    />,
  );
  const context = view.container.querySelector('.codiff-markdown-context p');
  expect(context?.querySelector('del')?.textContent).toBe('retired');
  expect(context?.querySelector('.codiff-markdown-deletion')).toBeNull();
  expect(context?.querySelector('pre, b')).toBeNull();
  expect(context?.querySelector('code')?.textContent).toBe('<b>');
  expect(view.container.querySelector('.codiff-markdown-deletion')?.textContent).toBe('Old');
});
