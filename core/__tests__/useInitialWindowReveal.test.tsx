/** @vitest-environment jsdom */
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { useInitialWindowReveal } from '../app/hooks/useInitialWindowReveal.ts';
import { renderReact } from './helpers/react.tsx';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const originalCodiff = window.codiff;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  vi.stubGlobal(
    'MessageChannel',
    class MessageChannel {
      port1 = {
        close: () => {
          this.port1.onmessage = null;
        },
        onmessage: null as (() => void) | null,
      };
      port2 = {
        close: () => {},
        postMessage: () => window.setTimeout(() => this.port1.onmessage?.(), 0),
      };
    },
  );
  window.codiff = { markWindowReady: vi.fn() } as unknown as Window['codiff'];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.codiff = originalCodiff;
  if (originalFonts) {
    Object.defineProperty(document, 'fonts', originalFonts);
  } else {
    Reflect.deleteProperty(document, 'fonts');
  }
});

function View({ loading = false, ready }: { loading?: boolean; ready: boolean }) {
  useInitialWindowReveal(ready);
  return (
    <main className="review">
      {loading ? (
        <div className="codiff-readonly-markdown-loading">Loading…</div>
      ) : ready ? (
        'Content'
      ) : (
        'Loading'
      )}
    </main>
  );
}

const paint = async () => {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  });
};

const finishPaint = async () => {
  await act(async () => vi.runAllTimersAsync());
};

test('reveals once after content, fonts, and a completed layout frame', async () => {
  const fonts = Promise.withResolvers<void>();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
  await using view = await renderReact(
    <StrictMode>
      <View ready={false} />
    </StrictMode>,
  );
  await paint();
  expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
  await view.rerender(
    <StrictMode>
      <View ready />
    </StrictMode>,
  );
  await paint();
  expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
  await act(async () => fonts.resolve());
  await paint();
  expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
  await finishPaint();
  expect(window.codiff.markWindowReady).toHaveBeenCalledOnce();
  await view.rerender(
    <StrictMode>
      <View ready={false} />
    </StrictMode>,
  );
  await view.rerender(
    <StrictMode>
      <View ready />
    </StrictMode>,
  );
  await paint();
  await finishPaint();
  expect(window.codiff.markWindowReady).toHaveBeenCalledOnce();
});

test('a view replaced while its fonts load cannot reveal stale content', async () => {
  const fonts = Promise.withResolvers<void>();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
  await using view = await renderReact(<View ready />);
  await view.rerender(<View ready={false} />);
  await act(async () => fonts.resolve());
  await paint();
  await finishPaint();
  expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
});

test('a visible Markdown preview finishes loading before the window is revealed', async () => {
  const measure = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 100, 100));
  try {
    await using view = await renderReact(<View loading ready />);
    await paint();
    await finishPaint();
    expect(window.codiff.markWindowReady).not.toHaveBeenCalled();
    await view.rerender(<View ready />);
    await paint();
    await finishPaint();
    expect(window.codiff.markWindowReady).toHaveBeenCalledOnce();
  } finally {
    measure.mockRestore();
  }
});
