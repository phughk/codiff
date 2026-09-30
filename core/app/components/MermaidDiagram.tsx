import { CodeIcon as Code } from '@phosphor-icons/react/Code';
import { FlowArrowIcon as FlowArrow } from '@phosphor-icons/react/FlowArrow';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

type MermaidView = 'diagram' | 'source';

const mermaidViewStorageKey = 'codiff:mermaid-view';
const mermaidViewListeners = new Set<() => void>();

const readStoredMermaidView = (): MermaidView => {
  try {
    return window.localStorage.getItem(mermaidViewStorageKey) === 'source' ? 'source' : 'diagram';
  } catch {
    return 'diagram';
  }
};

let mermaidView: MermaidView | null = null;

const getMermaidView = () => (mermaidView ??= readStoredMermaidView());

// Every diagram follows the same toggle, so choosing source shows source everywhere.
const setMermaidView = (view: MermaidView) => {
  mermaidView = view;
  try {
    window.localStorage.setItem(mermaidViewStorageKey, view);
  } catch {
    // The choice still applies for this session.
  }
  for (const listener of mermaidViewListeners) {
    listener();
  }
};

const subscribeMermaidView = (listener: () => void) => {
  mermaidViewListeners.add(listener);
  return () => {
    mermaidViewListeners.delete(listener);
  };
};

const darkSchemeQuery = '(prefers-color-scheme: dark)';

const isDarkTheme = () => {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme ? theme === 'dark' : window.matchMedia(darkSchemeQuery).matches;
};

const subscribeTheme = (listener: () => void) => {
  const media = window.matchMedia(darkSchemeQuery);
  const observer = new MutationObserver(listener);
  media.addEventListener('change', listener);
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
  return () => {
    media.removeEventListener('change', listener);
    observer.disconnect();
  };
};

type MermaidRender = { error: string } | { svg: string } | null;

// Mermaid is large, so it only loads once a description contains a diagram.
// Renders run one at a time because `initialize` sets global configuration.
let renderQueue: Promise<unknown> = Promise.resolve();

const renderMermaid = (id: string, code: string, dark: boolean) => {
  const next = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      securityLevel: 'strict',
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
    });
    const { svg } = await mermaid.render(id, code);
    return svg;
  });
  renderQueue = next.catch(() => {});
  return next;
};

export function MermaidDiagram({
  code,
  onHeightChange,
  source,
}: {
  code: string;
  onHeightChange?: (height: number) => void;
  source: ReactNode;
}) {
  const view = useSyncExternalStore(subscribeMermaidView, getMermaidView);
  const dark = useSyncExternalStore(subscribeTheme, isDarkTheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const id = `codiff-mermaid-${useId().replaceAll(/[^a-zA-Z0-9_-]/g, '')}`;
  const [result, setResult] = useState<{ key: string; render: MermaidRender }>({
    key: '',
    render: null,
  });
  const renderKey = `${dark ? 'dark' : 'light'}:${code}`;
  const render = result.key === renderKey ? result.render : null;

  useEffect(() => {
    if (view !== 'diagram') {
      return;
    }

    let cancelled = false;
    renderMermaid(id, code, dark).then(
      (svg) => {
        if (!cancelled) {
          setResult({ key: renderKey, render: { svg } });
        }
      },
      (error: unknown) => {
        // A failed render can leave Mermaid's scratch element behind.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) {
          setResult({
            key: renderKey,
            render: { error: error instanceof Error ? error.message : String(error) },
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, dark, id, renderKey, view]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      onHeightChange?.(container.getBoundingClientRect().height);
    }
  }, [onHeightChange, render, view]);

  const showSource = view === 'source' || (render != null && 'error' in render);

  return (
    <div className="codiff-mermaid" ref={containerRef}>
      <div aria-label="Mermaid diagram view" className="codiff-mermaid-toolbar" role="group">
        <button
          aria-pressed={view === 'diagram'}
          className="codiff-mermaid-toggle"
          onClick={() => setMermaidView('diagram')}
          title="Show rendered Mermaid diagrams"
          type="button"
        >
          <FlowArrow aria-hidden size={14} weight="bold" />
          Diagram
        </button>
        <button
          aria-pressed={view === 'source'}
          className="codiff-mermaid-toggle"
          onClick={() => setMermaidView('source')}
          title="Show Mermaid source only"
          type="button"
        >
          <Code aria-hidden size={14} weight="bold" />
          Source
        </button>
      </div>
      {view === 'diagram' && render != null && 'error' in render ? (
        <div className="codiff-mermaid-error">Could not render diagram: {render.error}</div>
      ) : null}
      {showSource ? (
        source
      ) : render != null && 'svg' in render ? (
        <div
          className="codiff-mermaid-diagram"
          // Mermaid's strict security level sanitizes the SVG it returns.
          dangerouslySetInnerHTML={{ __html: render.svg }}
        />
      ) : (
        <div className="codiff-mermaid-loading">Rendering diagram…</div>
      )}
    </div>
  );
}
