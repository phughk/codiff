import { frontmatterPlugin, imagePlugin } from '@nkzw/mdx-editor/core';
import { ReadOnlyMarkdownView } from './ReadOnlyMarkdownView.tsx';

const plugins = [
  frontmatterPlugin(),
  imagePlugin({ disableImageResize: true, disableImageSettingsButton: true }),
];

export default function MarkdownPreviewDocument({
  ariaLabel,
  className,
  density = 'document',
  onHeightChange,
  value,
  variant = 'plain',
}: {
  ariaLabel: string;
  className: string;
  density?: 'compact' | 'document';
  onHeightChange?: (height: number) => void;
  value: string;
  variant?: 'embedded' | 'plain';
}) {
  return (
    <ReadOnlyMarkdownView
      additionalPlugins={plugins}
      ariaLabel={ariaLabel}
      className={className}
      density={density}
      onHeightChange={onHeightChange}
      value={value}
      variant={variant}
    />
  );
}
