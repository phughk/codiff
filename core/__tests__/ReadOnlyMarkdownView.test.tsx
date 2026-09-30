/**
 * @vitest-environment jsdom
 */

import { expect, test, vi } from 'vite-plus/test';
import {
  extractFencedCodeBlocks,
  normalizeReadOnlyMarkdownValue,
  ReadOnlyMarkdownView,
  splitMermaidBlocks,
} from '../app/components/ReadOnlyMarkdownView.tsx';
import { renderReact, waitFor } from './helpers/react.tsx';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg class="rendered-mermaid"></svg>' })),
  },
}));

test('normalizeReadOnlyMarkdownValue collapses repeated blank lines outside fenced code', () => {
  expect(normalizeReadOnlyMarkdownValue('# Title\n\nNew paragraph.\n')).toBe(
    '# Title\n\nNew paragraph.\n',
  );
  expect(
    normalizeReadOnlyMarkdownValue(
      '\n\nFirst paragraph.\n\n\nSecond paragraph.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n\nThird paragraph.\n\n',
    ),
  ).toBe(
    'First paragraph.\n\nSecond paragraph.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nThird paragraph.',
  );
});

test('extractFencedCodeBlocks returns the contents of each fenced block', () => {
  expect(
    extractFencedCodeBlocks('Intro.\n\n```sh\nnpm install\n```\n\nOutro.\n\n~~~\nplain\n~~~\n'),
  ).toEqual(['npm install', 'plain']);
  expect(extractFencedCodeBlocks('No code here, only `inline`.')).toEqual([]);
  expect(extractFencedCodeBlocks('````\n```\nnested fence\n```\n````')).toEqual([
    '```\nnested fence\n```',
  ]);
  expect(extractFencedCodeBlocks('```ts\nconst a = 1;\n')).toEqual(['const a = 1;']);
  expect(extractFencedCodeBlocks('```\n\n```')).toEqual([]);
  expect(extractFencedCodeBlocks('```ts\nbefore\n```not-a-close\nafter\n```')).toEqual([
    'before\n```not-a-close\nafter',
  ]);
});

test('ReadOnlyMarkdownView copies the code inside a collapsible block', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });

  await using view = await renderReact(
    <ReadOnlyMarkdownView
      ariaLabel="Markdown preview"
      className="markdown-preview"
      value={
        '<details><summary>Fix in your Agent</summary>\n\nPaste this:\n\n```\nFix the issues.\n```\n\n</details>'
      }
      variant="embedded"
    />,
  );

  const button = view.container.querySelector<HTMLButtonElement>('.codiff-copy-code-button');
  expect(button).not.toBe(null);

  button?.click();

  await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith('Fix the issues.');
  });
});

test('ReadOnlyMarkdownView omits the copy button for collapsibles without code', async () => {
  await using view = await renderReact(
    <ReadOnlyMarkdownView
      ariaLabel="Markdown preview"
      className="markdown-preview"
      value={'<details><summary>Notes</summary>\n\nJust prose.\n\n</details>'}
      variant="embedded"
    />,
  );

  expect(view.container.querySelector('.codiff-copy-code-button')).toBe(null);
});

test('nested collapsibles copy only the code belonging to their own level', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });

  await using view = await renderReact(
    <ReadOnlyMarkdownView
      ariaLabel="Markdown preview"
      className="markdown-preview"
      value={
        '<details><summary>Outer</summary>\n\n```\nouter before\n```\n\n<details><summary>Inner</summary>\n\n```\ninner\n```\n\n</details>\n\n```\nouter after\n```\n\n</details>'
      }
      variant="embedded"
    />,
  );

  const details = view.container.querySelectorAll('details');
  const buttons = view.container.querySelectorAll<HTMLButtonElement>('.codiff-copy-code-button');
  expect(details).toHaveLength(2);
  expect(details[0]?.contains(details[1] ?? null)).toBe(true);
  expect(buttons).toHaveLength(2);

  buttons[0]?.click();
  await waitFor(() => {
    expect(writeText).toHaveBeenLastCalledWith('outer before\n\nouter after');
  });

  buttons[1]?.click();
  await waitFor(() => {
    expect(writeText).toHaveBeenLastCalledWith('inner');
  });
});

test('ReadOnlyMarkdownView does not render empty paragraph break blocks', async () => {
  await using view = await renderReact(
    <ReadOnlyMarkdownView
      ariaLabel="Markdown preview"
      className="markdown-preview"
      value={'\n\nFirst paragraph.\n\n\n\nSecond paragraph.\n\n  \n\nThird paragraph.\n\n'}
      variant="embedded"
    />,
  );

  await waitFor(() => {
    expect(view.container.textContent).toContain('First paragraph.');
    expect(view.container.textContent).toContain('Second paragraph.');
    expect(view.container.textContent).toContain('Third paragraph.');
  });
  expect(
    [
      ...view.container.querySelectorAll<HTMLElement>('[data-mdx-comment-block-type="paragraph"]'),
    ].some((paragraph) => !paragraph.textContent?.trim() && paragraph.querySelector('br')),
  ).toBe(false);
});

test('splitMermaidBlocks separates mermaid fences from the surrounding Markdown', () => {
  expect(
    splitMermaidBlocks(
      'Intro.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n````md\n```mermaid\nnot a diagram\n```\n````',
    ),
  ).toEqual([
    { type: 'markdown', value: 'Intro.\n' },
    {
      code: 'graph TD\n  A --> B',
      source: '```mermaid\ngraph TD\n  A --> B\n```',
      type: 'mermaid',
    },
    { type: 'markdown', value: '\n````md\n```mermaid\nnot a diagram\n```\n````' },
  ]);
  expect(splitMermaidBlocks('```mermaid\ngraph TD\n')).toEqual([
    { type: 'markdown', value: '```mermaid\ngraph TD\n' },
  ]);
});

test('ReadOnlyMarkdownView renders mermaid diagrams and toggles to source', async () => {
  await using view = await renderReact(
    <ReadOnlyMarkdownView
      ariaLabel="Markdown preview"
      className="markdown-preview"
      value={'Flow:\n\n```mermaid\ngraph TD\n  A --> B\n```\n'}
      variant="embedded"
    />,
  );

  await waitFor(() => {
    expect(view.container.querySelector('.codiff-mermaid-diagram .rendered-mermaid')).not.toBe(
      null,
    );
  });

  const [, sourceButton] =
    view.container.querySelectorAll<HTMLButtonElement>('.codiff-mermaid-toggle');
  sourceButton?.click();

  await waitFor(() => {
    expect(view.container.querySelector('.codiff-mermaid-diagram')).toBe(null);
    expect(sourceButton?.getAttribute('aria-pressed')).toBe('true');
  });
});
