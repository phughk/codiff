import { useEffect, useState } from 'react';

type GraphRender = { error: string } | { svg: string } | null;

type Viz = Awaited<ReturnType<(typeof import('@viz-js/viz'))['instance']>>;

// Graphviz is compiled to WebAssembly and only loads once a DOT file is previewed.
let vizPromise: Promise<Viz> | null = null;

const getViz = () => {
  vizPromise ??= import('@viz-js/viz').then(({ instance }) => instance());
  vizPromise.catch(() => {
    vizPromise = null;
  });
  return vizPromise;
};

/**
 * Graphviz output is untrusted, since the DOT source comes from the diff. Links
 * (`URL`/`href` attributes) and anything scriptable are removed so the preview
 * cannot navigate the window or run code.
 */
export const sanitizeGraphSvg = (svg: string) => {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.nodeName !== 'svg') {
    throw new Error('Graphviz did not produce an SVG.');
  }
  for (const element of root.querySelectorAll('script, foreignObject, iframe, image')) {
    element.remove();
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attributeName of element.getAttributeNames()) {
      const name = attributeName.toLowerCase();
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href') {
        element.removeAttribute(attributeName);
      }
    }
  }
  return new XMLSerializer().serializeToString(root);
};

export const renderGraphviz = async (source: string) => {
  const viz = await getViz();
  const result = viz.render(source, { format: 'svg' });
  if (result.status !== 'success') {
    throw new Error(
      result.errors
        .map((error) => error.message)
        .join('\n')
        .trim() || 'Graphviz could not render this graph.',
    );
  }
  return sanitizeGraphSvg(result.output);
};

function GraphPane({
  label,
  onLayoutReady,
  sectionId,
  source,
}: {
  label: string;
  onLayoutReady: (sectionId: string) => void;
  sectionId: string;
  source: string | null;
}) {
  const [result, setResult] = useState<{ render: GraphRender; source: string | null }>({
    render: null,
    source: null,
  });
  const render = result.source === source ? result.render : null;

  useEffect(() => {
    if (source == null) {
      return;
    }
    let cancelled = false;
    renderGraphviz(source).then(
      (svg) => {
        if (!cancelled) {
          setResult({ render: { svg }, source });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setResult({
            render: { error: error instanceof Error ? error.message : String(error) },
            source,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    onLayoutReady(sectionId);
  }, [onLayoutReady, render, sectionId]);

  return (
    <figure className="codiff-graph-pane" data-side={label.toLowerCase()}>
      <figcaption className="codiff-graph-pane-label">{label}</figcaption>
      {source == null ? (
        <div className="codiff-graph-empty">
          {label === 'Before' ? 'File did not exist' : 'File deleted'}
        </div>
      ) : render == null ? (
        <div className="codiff-graph-empty">Rendering graph…</div>
      ) : 'error' in render ? (
        <div className="codiff-graph-error" role="alert">
          Could not render graph: {render.error}
        </div>
      ) : (
        <div
          className="codiff-graph-render"
          // The SVG is sanitized by `sanitizeGraphSvg`.
          dangerouslySetInnerHTML={{ __html: render.svg }}
        />
      )}
    </figure>
  );
}

/** Renders a Graphviz DOT file before and after the change, side by side. */
export function GraphvizDiffPreview({
  after,
  before,
  onLayoutReady,
  sectionId,
}: {
  after: string | null;
  before: string | null;
  onLayoutReady: (sectionId: string) => void;
  sectionId: string;
}) {
  return (
    <div className="codiff-graph-preview">
      <GraphPane
        label="Before"
        onLayoutReady={onLayoutReady}
        sectionId={sectionId}
        source={before}
      />
      <GraphPane label="After" onLayoutReady={onLayoutReady} sectionId={sectionId} source={after} />
    </div>
  );
}
