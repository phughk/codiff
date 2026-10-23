import type { ChangedFile } from '../types.ts';
import type { DiffLineCount } from './app-types.ts';
import { getDiffLineCount, getTotalDiffLineCount } from './diff.ts';

export type DiffFileCategory = 'prod' | 'tests' | 'other';

const testDirectory =
  /^(?:__)?(?:tests?|specs?|fixtures?|snapshots?|mocks?)(?:__)?$|^(?:e2e|testdata|testutils|test-utils|testing|benchmarks?|cypress|playwright)$/i;
const testFilename =
  /(?:[._-](?:tests?|specs?|bench)(?:[._-]|$)|^(?:test[._-]|conftest\.|Test[A-Z])|Tests?\.[^.]+$)/;
const supportDirectory =
  /^(?:docs?|documentation|examples?|scripts?|tools?|tooling|bin|ci|\.github|\.gitlab|\.circleci|\.husky|\.vscode|\.idea|vendor|vendors|third[-_]party|node_modules|dist|coverage|out)$/i;
const supportFilename =
  /(?:^\.|[._-]config(?:[._-]|$)|(?:^|[._-])lock(?:[._-]|b?$)|^(?:readme|changelog|license|licence|contributing|authors|codeowners|makefile|gnumakefile|justfile|dockerfile|containerfile|procfile|gemfile|rakefile|brewfile)(?:[._-]|$)|^(?:package\.json|cargo\.toml|go\.(?:mod|sum|work)|pyproject\.toml|requirements[^/]*\.txt|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradlew(?:\.bat)?|tsconfig[^/]*\.json|jsconfig[^/]*\.json|npm-shrinkwrap\.json)$)/i;
const sourceExtension =
  /\.(?:[cm]?[jt]sx?|[ch](?:pp|xx)?|cc|cs|fsx?|vb|go|rs|pyi?|rb|php|java|kt|kts|scala|swift|m|mm|dart|exs?|erl|hrl|hs|lhs|clj[cs]?|cljs|edn|elm|ml|mli|lua|pl|pm|r|jl|zig|nim|vue|svelte|astro|html?|css|scss|sass|less|styl|sql|graphql|gql|proto|prisma|sol|ex|eex|heex|erb|hbs|mustache|twig|jinja2?|liquid|razor|cshtml|xaml|wgsl|glsl|vert|frag)$/i;
const resourceExtension =
  /\.(?:svg|png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|mp[34]|wav|ogg|webm|pdf|po|pot|arb|strings|stringsdict|resx)$/i;
const runtimeDirectory =
  /^(?:src|app|lib|assets|resources|public|static|locales|translations|migrations|schemas)$/i;

/** File roles, rather than languages: specific test/tooling conventions win over source extensions. */
export const getDiffFileCategory = (path: string): DiffFileCategory => {
  const parts = path.replaceAll('\\', '/').split('/');
  const filename = parts.at(-1) ?? '';
  const directories = parts.slice(0, -1);

  if (
    directories.some((part) => testDirectory.test(part)) ||
    (sourceExtension.test(filename) && testFilename.test(filename)) ||
    /\.(?:snap|snapshot)$/i.test(filename)
  ) {
    return 'tests';
  }
  if (
    directories.some((part) => supportDirectory.test(part)) ||
    supportFilename.test(filename) ||
    /\.(?:mdx?|rst|adoc|sh|bash|zsh|fish|ps1|bat|cmd)$/i.test(filename)
  ) {
    return 'other';
  }
  if (
    sourceExtension.test(filename) ||
    resourceExtension.test(filename) ||
    (directories.some((part) => runtimeDirectory.test(part)) &&
      /\.(?:json|ya?ml|toml|xml|csv|tsv|txt|wasm)$/i.test(filename))
  ) {
    return 'prod';
  }
  return 'other';
};

export const getDiffSummary = (files: ReadonlyArray<ChangedFile>, showWhitespace: boolean) => {
  const categories: Record<DiffFileCategory, DiffLineCount> = {
    other: { additions: 0, countable: true, deletions: 0 },
    prod: { additions: 0, countable: true, deletions: 0 },
    tests: { additions: 0, countable: true, deletions: 0 },
  };
  const lineCounts = files.map((file) => {
    const lineCount = getDiffLineCount(file, showWhitespace);
    if (lineCount.countable) {
      const category = categories[getDiffFileCategory(file.path)];
      category.additions += lineCount.additions;
      category.deletions += lineCount.deletions;
    }
    return lineCount;
  });
  return { categories, total: getTotalDiffLineCount(lineCounts) };
};
