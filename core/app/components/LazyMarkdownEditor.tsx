import { lazy, Suspense, type ComponentProps } from 'react';

let modulePromise:
  | Promise<{ default: typeof import('./MarkdownImageSource.tsx').ImageSourceMarkdownEditor }>
  | undefined;
export const preloadMarkdownEditor = () =>
  (modulePromise ??= import('./MarkdownImageSource.tsx').then(({ ImageSourceMarkdownEditor }) => ({
    default: ImageSourceMarkdownEditor,
  })));

const Editor = lazy(preloadMarkdownEditor);
export function MarkdownEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<div className="codiff-readonly-markdown-loading">Loading…</div>}>
      <Editor {...props} />
    </Suspense>
  );
}
