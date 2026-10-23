/**
 * @vitest-environment jsdom
 */

import { lazy, Suspense } from 'react';
import { expect, test } from 'vite-plus/test';
import { renderReact, waitFor } from './helpers/react.tsx';

test('waitFor allows a lazy component to finish loading', async () => {
  const LazyContent = lazy(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { default: () => <p>Ready</p> };
  });

  await using view = await renderReact(
    <Suspense fallback={<p>Loading</p>}>
      <LazyContent />
    </Suspense>,
  );

  await waitFor(() => {
    expect(view.container.textContent).toBe('Ready');
  });
});
