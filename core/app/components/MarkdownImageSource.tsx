import { MarkdownEditor } from '@nkzw/mdx-editor';
import { imagePreviewHandler$, realmPlugin, type RealmPlugin } from '@nkzw/mdx-editor/core';
import { type ComponentProps, useContext, useMemo } from 'react';
import { MarkdownImageSourceContext } from '../../lib/markdownImageSource.ts';

// Only the rendered `src` changes; the image node keeps its original source, so edits
// serialize the Markdown as written.
const imageSourcePlugin = realmPlugin<(source: string) => Promise<string>>({
  postInit: (realm, previewImage) => realm.pub(imagePreviewHandler$, previewImage ?? null),
  update: (realm, previewImage) => realm.pub(imagePreviewHandler$, previewImage ?? null),
});

function useMarkdownImagePlugins(plugins: Array<RealmPlugin> | undefined) {
  const resolveImageSource = useContext(MarkdownImageSourceContext);
  return useMemo(() => {
    if (!resolveImageSource) {
      return plugins;
    }
    const previewImage = (source: string) => Promise.resolve(resolveImageSource(source));
    return [...(plugins ?? []), imageSourcePlugin(previewImage)];
  }, [plugins, resolveImageSource]);
}

export function ImageSourceMarkdownEditor({
  additionalPlugins,
  ...props
}: ComponentProps<typeof MarkdownEditor>) {
  return (
    <MarkdownEditor {...props} additionalPlugins={useMarkdownImagePlugins(additionalPlugins)} />
  );
}
