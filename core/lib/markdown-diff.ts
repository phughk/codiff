import { diffArrays } from 'diff';
import type { Element, RootContent } from 'hast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast, type Handler } from 'mdast-util-to-hast';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';

export type MarkdownBlock = {
  endLine: number;
  key: string;
  node: Element;
  source: string;
  startLine: number;
};

export type MarkdownChange = {
  after?: MarkdownBlock;
  before?: MarkdownBlock;
  kind: 'unchanged' | 'added' | 'removed' | 'modified' | 'source';
};

// Compare rendered structure, retaining the original source separately so
// syntax-only changes never disappear from the rendered review.
const comparableNode = (node: RootContent, literal = false): unknown => {
  if (node.type === 'text') {
    return { type: node.type, value: literal ? node.value : node.value.replaceAll(/\s+/g, ' ') };
  }
  if (node.type === 'element') {
    return {
      children: node.children.map((child) =>
        comparableNode(child, literal || node.tagName === 'pre' || node.tagName === 'code'),
      ),
      properties: node.properties,
      tagName: node.tagName,
      type: node.type,
    };
  }
  return { type: node.type };
};

const nodeKey = (node: RootContent) => JSON.stringify(comparableNode(node));

export const parseMarkdownBlocks = (contents: string): Array<MarkdownBlock> => {
  const tree = fromMarkdown(contents, {
    extensions: [gfm(), frontmatter(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
  });
  // Unsupported HTML, frontmatter, and reference definitions remain visible as
  // literal source. Never execute repository HTML or discard an invisible edit.
  const literal: Handler = (_state, node, parent) => ({
    children: [
      {
        type: 'text',
        value: contents.slice(node.position?.start.offset, node.position?.end.offset),
      },
    ],
    position: node.position,
    properties: { className: ['codiff-markdown-literal'] },
    tagName: parent?.type === 'root' ? 'pre' : 'code',
    type: 'element',
  });
  const rendered = toHast(tree, {
    handlers: { definition: literal, html: literal, yaml: literal },
  });
  if (rendered.type !== 'root') {
    return [];
  }
  return rendered.children.flatMap((node) =>
    node.type === 'element'
      ? [
          {
            endLine: node.position?.end.line ?? tree.position?.end.line ?? 1,
            key: nodeKey(node),
            node,
            source: node.position
              ? contents.slice(node.position.start.offset, node.position.end.offset)
              : '',
            startLine: node.position?.start.line ?? 1,
          },
        ]
      : [],
  );
};

const sourceBlock = (contents: string): MarkdownBlock => ({
  endLine: contents.split('\n').length,
  key: contents,
  node: { children: [], properties: {}, tagName: 'div', type: 'element' },
  source: contents,
  startLine: 1,
});

export const getMarkdownChanges = (
  oldContents: string,
  newContents: string,
): ReadonlyArray<MarkdownChange> => {
  const before = parseMarkdownBlocks(oldContents);
  const after = parseMarkdownBlocks(newContents);
  // Bound worst-case work for large documents with nothing in common.
  const parts = diffArrays(before, after, {
    comparator: (a, b) => a.key === b.key,
    maxEditLength: 1000,
  }) ?? [
    { added: false, removed: true, value: before },
    { added: true, removed: false, value: after },
  ];
  const changes: Array<MarkdownChange> = [];
  let oldIndex = 0;
  let newIndex = 0;
  const removed: Array<MarkdownBlock> = [];
  const added: Array<MarkdownBlock> = [];
  const flush = () => {
    // Pair blocks in source order. Different block types are a structural
    // deletion/insertion, rather than a misleading inline text replacement.
    while (removed.length || added.length) {
      const a = removed[0];
      const b = added[0];
      if (a && b && a.node.tagName === b.node.tagName) {
        changes.push({ after: added.shift(), before: removed.shift(), kind: 'modified' });
      } else if (a) {
        changes.push({ before: removed.shift(), kind: 'removed' });
      } else {
        changes.push({ after: added.shift(), kind: 'added' });
      }
    }
  };
  for (const part of parts) {
    if (part.removed) {
      removed.push(...before.slice(oldIndex, oldIndex + part.value.length));
      oldIndex += part.value.length;
    } else if (part.added) {
      added.push(...after.slice(newIndex, newIndex + part.value.length));
      newIndex += part.value.length;
    } else {
      flush();
      for (let index = 0; index < part.value.length; index += 1) {
        const a = before[oldIndex++];
        const b = after[newIndex++];
        changes.push({ after: b, before: a, kind: a.source === b.source ? 'unchanged' : 'source' });
      }
    }
  }
  flush();
  // Blank lines and final-newline changes have no rendered block of their own.
  if (oldContents !== newContents && changes.every((change) => change.kind === 'unchanged')) {
    changes.push({
      after: sourceBlock(newContents),
      before: sourceBlock(oldContents),
      kind: 'source',
    });
  }
  return changes;
};

export type MarkdownChangeGroup = {
  changes: ReadonlyArray<MarkdownChange>;
  collapsed: boolean;
};

export const groupMarkdownChanges = (
  changes: ReadonlyArray<MarkdownChange>,
): ReadonlyArray<MarkdownChangeGroup> => {
  const visible = new Set<number>();
  let heading = -1;
  changes.forEach((change, index) => {
    if (/^h[1-6]$/.test((change.after ?? change.before)?.node.tagName ?? '')) {
      heading = index;
    }
    if (change.kind !== 'unchanged') {
      for (const candidate of [heading, index - 1, index, index + 1]) {
        if (candidate >= 0 && candidate < changes.length) {
          visible.add(candidate);
        }
      }
    }
  });
  const groups: Array<{ changes: Array<MarkdownChange>; collapsed: boolean }> = [];
  changes.forEach((change, index) => {
    const collapsed = !visible.has(index);
    let group = groups.at(-1);
    if (!group || group.collapsed !== collapsed) {
      group = { changes: [], collapsed };
      groups.push(group);
    }
    group.changes.push(change);
  });
  return groups;
};

const inlineProperties = (node: Element, ignoreLinkDestination: boolean) => {
  if (ignoreLinkDestination && node.tagName === 'a') {
    const { href: _href, title: _title, ...properties } = node.properties;
    return properties;
  }
  return node.properties;
};

export const getMarkdownText = (node: RootContent): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element'
      ? node.children.map(getMarkdownText).join('')
      : '';

export const canDiffMarkdownInline = (
  before: RootContent,
  after: RootContent,
  ignoreLinkDestination = false,
): boolean => {
  if (before.type === 'text' && after.type === 'text') {
    return true;
  }
  return (
    before.type === 'element' &&
    after.type === 'element' &&
    before.tagName === after.tagName &&
    JSON.stringify(inlineProperties(before, ignoreLinkDestination)) ===
      JSON.stringify(inlineProperties(after, ignoreLinkDestination)) &&
    before.children.length === after.children.length &&
    before.children.every((child, index) =>
      canDiffMarkdownInline(child, after.children[index], ignoreLinkDestination),
    )
  );
};

export const getMarkdownAttributeChanges = (
  before: RootContent,
  after: RootContent,
): Array<{ before: string; label: string; value: string }> => {
  if (before.type !== 'element' || after.type !== 'element' || before.tagName !== after.tagName) {
    return [];
  }
  return [
    ...(['href', 'src', 'alt', 'title'] as const).flatMap((key) =>
      before.properties[key] === after.properties[key]
        ? []
        : [
            {
              before: String(before.properties[key] ?? '(none)'),
              label: {
                alt: 'Image description',
                href: 'Link destination',
                src: 'Image source',
                title: 'Title',
              }[key],
              value: String(after.properties[key] ?? '(none)'),
            },
          ],
    ),
    ...(before.children.length === after.children.length
      ? before.children.flatMap((child, index) =>
          getMarkdownAttributeChanges(child, after.children[index]),
        )
      : []),
  ];
};
