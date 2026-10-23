import { expect, test } from 'vite-plus/test';
import { getDiffFileCategory, getDiffSummary } from '../lib/diff-summary.ts';
import { createChangedFile } from './helpers/fixtures.ts';

test.each([
  'src/App.tsx',
  'core/config/defaults.ts',
  'src/config.ts',
  'lib/client.generated.ts',
  'src/styles.css',
  'app/page.vue',
  'server/main.go',
  'src/main.rs',
  'app/models/user.rb',
  'migrations/001_users.sql',
  'assets/icon.svg',
  'public/font.woff2',
  'locales/en.json',
  'src/resources/defaults.yaml',
])('classifies runtime source and resources as Prod: %s', (path) => {
  expect(getDiffFileCategory(path)).toBe('prod');
});

test.each([
  'src/App.test.tsx',
  'src/App.spec.ts',
  'src/parse.bench.ts',
  'core/__tests__/helpers/setup.ts',
  'tests/fixtures/example.ts',
  'src/__snapshots__/App.snap',
  'testdata/response.json',
  'e2e/login.ts',
  'cypress/support/commands.ts',
  'scripts/release.test.ts',
  'lib/parser_test.go',
  'src/parser_tests.rs',
  'lib/test_parser.py',
  'tests/conftest.py',
  'src/ParserTest.java',
  'src/TestParser.java',
  'benchmarks/parser.rs',
  'AppTests/ParserTests.cs',
  String.raw`src\__mocks__\client.ts`,
])('includes test support files in Tests: %s', (path) => {
  expect(getDiffFileCategory(path)).toBe('tests');
});

test.each([
  'README.md',
  'docs/example.ts',
  'examples/demo.tsx',
  'scripts/release.ts',
  'tools/build.py',
  'bin/codiff.js',
  '.github/workflows/test.yml',
  '.gitlab-ci.yml',
  'Dockerfile',
  'Makefile',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.build.json',
  'package.json',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'pyproject.toml',
  'vendor/library/src/index.js',
  'dist/index.js',
  'release.sh',
  'data/unknown.json',
  'unknown.custom',
])('keeps tooling, dependencies, documentation and unknown files in Other: %s', (path) => {
  expect(getDiffFileCategory(path)).toBe('other');
});

test('category counts partition the same loaded text changes as the total', () => {
  const files = [
    createChangedFile('src/app.ts', {
      patch: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1,3 @@\n-old\n+new\n+two\n+three\n',
    }),
    createChangedFile('src/app.test.ts'),
    createChangedFile('tests/fixtures/input.json'),
    createChangedFile('scripts/build.ts', {
      patch:
        'diff --git a/scripts/build.ts b/scripts/build.ts\n@@ -1,2 +1 @@\n-old\n-removed\n+new\n',
    }),
    createChangedFile('pnpm-lock.yaml'),
    {
      ...createChangedFile('assets/image.png'),
      sections: [{ binary: true, id: 'image', kind: 'unstaged' as const, patch: '' }],
    },
    {
      ...createChangedFile('src/deferred.ts'),
      sections: [
        {
          binary: false,
          id: 'deferred',
          kind: 'unstaged' as const,
          loadState: 'deferred' as const,
          patch: '',
        },
      ],
    },
  ];

  expect(getDiffSummary(files, false)).toEqual({
    categories: {
      other: { additions: 2, countable: true, deletions: 3 },
      prod: { additions: 3, countable: true, deletions: 1 },
      tests: { additions: 2, countable: true, deletions: 2 },
    },
    total: { additions: 7, countable: true, deletions: 6 },
  });
  expect(getDiffSummary([], false).total.countable).toBe(false);
});
