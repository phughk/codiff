import { createContext } from 'react';

export type ResolveMarkdownImageSource = (source: string) => string;

export const MarkdownImageSourceContext = createContext<ResolveMarkdownImageSource | null>(null);

export const MarkdownImageSourceProvider = MarkdownImageSourceContext.Provider;
