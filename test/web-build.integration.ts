import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

const readBuildFile = (path: string) =>
  readFile(new URL(`../web/dist/${path}`, import.meta.url), 'utf8');

test('serves built assets outside the Worker and preloads page chunks with the entry', async () => {
  const config = JSON.parse(await readBuildFile('ssr/wrangler.json'));
  expect(config.compatibility_flags).toContain('new_module_registry');
  expect(config.assets.run_worker_first).toEqual(
    expect.arrayContaining([
      '/**',
      '!/__assets-v2/*',
      '!/fonts/*',
      '!/icon.png',
      '!/apple-touch-icon.png',
    ]),
  );
  expect(await readBuildFile('client/_headers')).toContain(
    '/__assets-v2/*\n  Cache-Control: public, max-age=31536000, immutable\n',
  );
  const manifest = JSON.parse(await readBuildFile('client/.vite/manifest.json'));
  const entry = manifest['virtual:void-pages-client'];
  expect(entry.imports).toEqual(expect.arrayContaining(['pages/index.tsx', 'pages/[...].tsx']));
  expect(entry.dynamicImports).toEqual(
    expect.arrayContaining(['pages/index.tsx', 'pages/[...].tsx']),
  );
});
