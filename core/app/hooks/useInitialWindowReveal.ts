import { useCallback, useEffect, useRef } from 'react';

// Native ready-to-show only promises a paint, which may contain an empty shell.
// Wait for the actual view, its fonts, and a frame containing the final layout.
export function useInitialWindowReveal(ready: boolean) {
  const revealed = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const reveal = useCallback(() => {
    if (revealed.current || pending.current) {
      return;
    }
    let canceled = false;
    let frame: number;
    const channel = new MessageChannel();
    const deadline = performance.now() + 1000;
    pending.current = () => {
      canceled = true;
      cancelAnimationFrame(frame);
      channel.port1.close();
      channel.port2.close();
    };
    channel.port1.onmessage = () => {
      if (canceled) {
        return;
      }
      const loadingPreview = [
        ...document.querySelectorAll<HTMLElement>(
          '.review .codiff-readonly-markdown-loading, .review .codiff-markdown-editor-message:not(.error)',
        ),
      ].some((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight;
      });
      if (
        performance.now() < deadline &&
        (loadingPreview || document.fonts?.status === 'loading')
      ) {
        prepareFrame();
        return;
      }
      revealed.current = true;
      pending.current = null;
      channel.port1.close();
      channel.port2.close();
      window.codiff.markWindowReady();
    };
    const prepareFrame = () => {
      if (canceled) {
        return;
      }
      frame = requestAnimationFrame(() => {
        // A message runs after this frame's paint without setTimeout's 4ms
        // nesting clamp, another refresh cycle, or a parent React render.
        channel.port2.postMessage(null);
      });
    };
    void (document.fonts?.ready ?? Promise.resolve()).then(prepareFrame);
  }, []);
  useEffect(() => {
    if (ready) {
      reveal();
    }
    return () => {
      pending.current?.();
      pending.current = null;
    };
  }, [ready, reveal]);
  return reveal;
}
