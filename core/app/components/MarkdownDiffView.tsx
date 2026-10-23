import { diffLines, diffWordsWithSpace } from 'diff';
import type { Element, RootContent } from 'hast';
import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import {
  canDiffMarkdownInline,
  getMarkdownAttributeChanges,
  getMarkdownChanges,
  getMarkdownText,
  groupMarkdownChanges,
  type MarkdownBlock,
  type MarkdownChange,
} from '../../lib/markdown-diff.ts';

const safeURL = (value: unknown, image = false) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value, 'https://codiff.invalid');
    return ['http:', 'https:', ...(image ? [] : ['mailto:'])].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

const renderElement = (node: Element, children: ReactNode): ReactNode => {
  const properties = node.properties;
  const props = {
    alt: typeof properties.alt === 'string' ? properties.alt : undefined,
    checked: typeof properties.checked === 'boolean' ? properties.checked : undefined,
    className: Array.isArray(properties.className) ? properties.className.join(' ') : undefined,
    disabled: properties.disabled === true ? true : undefined,
    href: safeURL(properties.href),
    id: typeof properties.id === 'string' ? properties.id : undefined,
    src: safeURL(properties.src, true),
    start: typeof properties.start === 'number' ? properties.start : undefined,
    style: properties.align
      ? { textAlign: String(properties.align) as 'left' | 'center' | 'right' }
      : undefined,
    title: typeof properties.title === 'string' ? properties.title : undefined,
    type: properties.type === 'checkbox' ? 'checkbox' : undefined,
    ...(node.tagName === 'a' ? { rel: 'noreferrer', target: '_blank' } : {}),
  };
  return createElement(
    node.tagName,
    props,
    ['br', 'hr', 'img', 'input'].includes(node.tagName) ? undefined : children,
  );
};

const renderNode = (node: RootContent): ReactNode =>
  node.type === 'text'
    ? node.value
    : node.type === 'element'
      ? renderElement(
          node,
          renderedChildren(node).map((child, index) => (
            <Fragment key={index}>{renderNode(child)}</Fragment>
          )),
        )
      : null;

// HAST includes formatting newlines between table elements. React requires
// only the structural children in these containers, including during SSR.
const renderedChildren = (node: Element) =>
  ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(node.tagName)
    ? node.children.filter((child) => child.type !== 'text' || child.value.trim())
    : node.children;

const hasSimilarText = (before: Element, after: Element) => {
  const a = getMarkdownText(before);
  const b = getMarkdownText(after);
  if (Math.max(a.trim().split(/\s+/).length, b.trim().split(/\s+/).length) <= 3) {
    return true;
  }
  const parts = diffWordsWithSpace(a, b, { maxEditLength: 1000 });
  return (
    parts != null &&
    parts
      .filter((part) => part.added || part.removed)
      .reduce((length, part) => length + part.value.length, 0) <=
      (a.length + b.length) * 0.65
  );
};

const renderInlineDiff = (before: RootContent, after: RootContent): ReactNode => {
  if (before.type === 'text' && after.type === 'text') {
    const parts = diffWordsWithSpace(before.value, after.value, { maxEditLength: 1000 }) ?? [
      { added: false, removed: true, value: before.value },
      { added: true, removed: false, value: after.value },
    ];
    return parts.map((part, index) =>
      part.added ? (
        <ins className="codiff-markdown-insertion" key={index}>
          {part.value}
        </ins>
      ) : part.removed ? (
        <del className="codiff-markdown-deletion" key={index}>
          {part.value}
        </del>
      ) : (
        <Fragment key={index}>{part.value}</Fragment>
      ),
    );
  }
  return before.type === 'element' && after.type === 'element'
    ? renderElement(
        after,
        renderedChildren(after).map((child, index) => (
          <Fragment key={index}>
            {renderInlineDiff(renderedChildren(before)[index], child)}
          </Fragment>
        )),
      )
    : renderNode(after);
};

function MarkdownSourceChange({ after, before }: { after: string; before: string }) {
  const parts = diffLines(before, after, { maxEditLength: 1000 }) ?? [
    { added: false, removed: true, value: before },
    { added: true, removed: false, value: after },
  ];
  return (
    <details className="codiff-markdown-source-change">
      <summary>Markdown syntax changed</summary>
      <pre>
        <code>
          {parts.map((part, index) => (
            <span
              className={part.added ? 'added' : part.removed ? 'removed' : undefined}
              key={index}
            >
              {part.value}
            </span>
          ))}
        </code>
      </pre>
    </details>
  );
}

export function MarkdownDiffView({
  newContents,
  oldContents,
  onViewSource,
  path,
}: {
  newContents: string;
  oldContents: string;
  onViewSource: (lineNumber: number, side: 'additions' | 'deletions') => void;
  path: string;
}) {
  const changes = useMemo(
    () => getMarkdownChanges(oldContents, newContents),
    [oldContents, newContents],
  );
  const groups = useMemo(() => groupMarkdownChanges(changes), [changes]);
  const anchor = (block: MarkdownBlock, side: 'additions' | 'deletions') => (
    <button
      className="codiff-markdown-source-anchor"
      onClick={() => onViewSource(block.startLine, side)}
      title={`View ${side === 'deletions' ? 'old' : 'new'} source at line ${block.startLine}`}
      type="button"
    >
      {side === 'deletions' ? 'Old' : 'New'} L{block.startLine}
      {block.endLine > block.startLine ? `–${block.endLine}` : ''}
    </button>
  );
  const renderChange = (change: MarkdownChange, index: number) => {
    const { after, before, kind } = change;
    if (kind === 'unchanged') {
      return (
        <div className="codiff-markdown-context" key={index}>
          {renderNode(after!.node)}
        </div>
      );
    }
    const inline =
      kind === 'modified' &&
      canDiffMarkdownInline(before!.node, after!.node) &&
      hasSimilarText(before!.node, after!.node);
    const attributes = before && after ? getMarkdownAttributeChanges(before.node, after.node) : [];
    const linkOnly =
      kind === 'modified' &&
      attributes.length > 0 &&
      canDiffMarkdownInline(before!.node, after!.node, true) &&
      getMarkdownText(before!.node) === getMarkdownText(after!.node);
    return (
      <section
        aria-label={kind === 'source' ? 'Markdown syntax changed' : 'Markdown change'}
        className={`codiff-markdown-change ${kind}`}
        data-markdown-change=""
        data-new-line={after?.startLine}
        data-old-line={before?.startLine}
        key={index}
      >
        <div className="codiff-markdown-change-header">
          <span>
            {kind === 'added'
              ? '+ Added'
              : kind === 'removed'
                ? '− Removed'
                : kind === 'source'
                  ? 'Source changed'
                  : 'Changed'}
          </span>
          <span>
            {before ? anchor(before, 'deletions') : null}
            {after ? anchor(after, 'additions') : null}
          </span>
        </div>
        {inline ? (
          renderInlineDiff(before!.node, after!.node)
        ) : kind === 'source' || linkOnly ? (
          renderNode(after!.node)
        ) : (
          <>
            {before ? (
              <div aria-label="Removed content" className="codiff-markdown-before">
                {renderNode(before.node)}
              </div>
            ) : null}
            {after ? (
              <div aria-label="Added content" className="codiff-markdown-after">
                {renderNode(after.node)}
              </div>
            ) : null}
          </>
        )}
        {attributes.map((attribute, attributeIndex) => (
          <div className="codiff-markdown-attribute-change" key={attributeIndex}>
            <span>{attribute.label}</span>
            <div>
              <del className="codiff-markdown-deletion">{attribute.before}</del> →{' '}
              <ins className="codiff-markdown-insertion">{attribute.value}</ins>
            </div>
          </div>
        ))}
        {kind === 'source' ? (
          <MarkdownSourceChange after={after!.source} before={before!.source} />
        ) : null}
      </section>
    );
  };
  return (
    <div aria-label={`Changes to ${path}`} className="codiff-markdown-diff">
      {changes.every((change) => change.kind === 'unchanged') ? (
        <p className="codiff-markdown-context">No content changes.</p>
      ) : null}
      {groups.map((group, index) =>
        group.collapsed ? (
          <details className="codiff-markdown-unchanged" key={index}>
            <summary>
              Show {group.changes.length} unchanged{' '}
              {group.changes.length === 1 ? 'block' : 'blocks'}
            </summary>
            {group.changes.map(renderChange)}
          </details>
        ) : (
          <Fragment key={index}>{group.changes.map(renderChange)}</Fragment>
        ),
      )}
    </div>
  );
}
