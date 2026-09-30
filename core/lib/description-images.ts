import { createContext, useContext } from 'react';

/**
 * Images in a pull request description that the renderer cannot load on its
 * own, such as attachments on a private GitHub repository, keyed by the URL in
 * the description and resolved to a URL the renderer can load.
 */
export type DescriptionImages = Readonly<Record<string, string>>;

const emptyDescriptionImages: DescriptionImages = {};

export const DescriptionImagesContext = createContext<DescriptionImages>(emptyDescriptionImages);

export const useDescriptionImages = () => useContext(DescriptionImagesContext);

const imageSourcePattern =
  /(!\[[^\]\n]*\]\()([^)\s]+)|(<img\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

/** Replaces resolvable image sources for display only; the stored description keeps the originals. */
export const applyDescriptionImages = (markdown: string, images: DescriptionImages) => {
  if (Object.keys(images).length === 0) {
    return markdown;
  }
  return markdown.replaceAll(
    imageSourcePattern,
    (
      match,
      markdownPrefix: string | undefined,
      markdownSource: string | undefined,
      htmlPrefix: string | undefined,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
    ) => {
      if (markdownPrefix != null && markdownSource != null) {
        const resolved = images[markdownSource];
        return resolved ? `${markdownPrefix}${resolved}` : match;
      }
      const source = doubleQuoted ?? singleQuoted ?? '';
      const resolved = images[source];
      return resolved ? `${htmlPrefix}"${resolved}"` : match;
    },
  );
};
