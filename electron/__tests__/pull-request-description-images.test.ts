import { chmod, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  createTemporaryDirectory,
  createTemporaryEnvironment,
} from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { readPullRequestDescriptionImages } = require('../git-state/pull-request.cjs') as {
  readPullRequestDescriptionImages: (
    repoRoot: string,
    pullRequest: { number: number; owner: string; repo: string; url: string },
    metadata: { base?: { repo?: { private?: boolean } }; body?: string | null },
  ) => Promise<Record<string, string> | undefined>;
};

const pullRequest = {
  number: 7,
  owner: 'acme',
  repo: 'secret',
  url: 'https://github.com/acme/secret/pull/7',
};
const assetId = 'aa603b86-ffdf-47aa-8eb6-36283cc4c17a';
const attachmentUrl = `https://github.com/user-attachments/assets/${assetId}`;
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const startImageServer = async () => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith(`/1/1-${assetId}.png`)) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(pngBytes);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    [Symbol.asyncDispose]: () => new Promise<void>((resolve) => server.close(() => resolve())),
    origin: `http://127.0.0.1:${port}`,
  };
};

test('resolves private pull request description attachments to data URLs', async () => {
  await using directory = await createTemporaryDirectory('codiff-description-images-');
  await using server = await startImageServer();
  const signedUrl = `${server.origin}/1/1-${assetId}.png?jwt=abc&amp;x=1`;
  const fakeGh = join(directory.path, 'gh');
  await writeFile(
    fakeGh,
    `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({
      body_html: `<p><a href="${signedUrl}"><img alt="shot" src="${signedUrl}"></a></p>`,
    })}\nJSON\n`,
  );
  await chmod(fakeGh, 0o755);
  await using _environment = createTemporaryEnvironment({ CODIFF_GH_PATH: fakeGh });

  const images = await readPullRequestDescriptionImages(directory.path, pullRequest, {
    base: { repo: { private: true } },
    body: `Before\n\n<img width="10" alt="shot" src="${attachmentUrl}" />\n\n![external](https://example.com/a.png)`,
  });

  expect(images).toEqual({
    [attachmentUrl]: `data:image/png;base64,${pngBytes.toString('base64')}`,
  });
});

test('skips description image resolution for public repositories and bodies without attachments', async () => {
  await using directory = await createTemporaryDirectory('codiff-description-images-public-');
  const fakeGh = join(directory.path, 'gh');
  await writeFile(fakeGh, '#!/bin/sh\necho called >&2\nexit 1\n');
  await chmod(fakeGh, 0o755);
  await using _environment = createTemporaryEnvironment({ CODIFF_GH_PATH: fakeGh });

  await expect(
    readPullRequestDescriptionImages(directory.path, pullRequest, {
      base: { repo: { private: false } },
      body: `![shot](${attachmentUrl})`,
    }),
  ).resolves.toBeUndefined();
  await expect(
    readPullRequestDescriptionImages(directory.path, pullRequest, {
      body: '![external](https://example.com/a.png)',
    }),
  ).resolves.toBeUndefined();
});
