// @ts-check

const {
  getSectionWalkthroughHunks,
  isGeneratedWalkthroughFile,
  isSyntheticWalkthroughHunk,
} = require('../core/lib/narrative-walkthrough-diff.cjs');
const { parseJSONMessage, truncate } = require('./agent-shared.cjs');

/**
 * @typedef {import('../core/types.ts').AgentReviewComment} AgentReviewComment
 * @typedef {import('../core/types.ts').AgentReviewResult} AgentReviewResult
 * @typedef {import('../core/types.ts').AgentReviewSeverity} AgentReviewSeverity
 * @typedef {import('../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('./agent.cjs').Agent} Agent
 * @typedef {import('./agent.cjs').AgentOptions} AgentOptions
 * @typedef {ReturnType<typeof getSectionWalkthroughHunks>[number]} SectionHunk
 * @typedef {{line: number; side: 'additions' | 'deletions'}} CommentTarget
 * @typedef {{hunk: SectionHunk; lines: ReturnType<typeof getCommentableLines>}} IndexedHunk
 */

const MAX_TOTAL_PATCH_CHARS = 160_000;
const MAX_HUNK_PATCH_CHARS = 12_000;
const MAX_SOURCE_DESCRIPTION_CHARS = 4_000;
const MAX_REVIEW_COMMENTS = 30;
const BASE_TIMEOUT_MS = 120_000;
const TIMEOUT_MS_PER_HUNK = 2_000;
const MAX_TIMEOUT_MS = 600_000;

/** @type {ReadonlyArray<AgentReviewSeverity>} */
const SEVERITIES = ['blocker', 'issue', 'suggestion', 'question', 'nit'];

const agentReviewSchema = {
  additionalProperties: false,
  properties: {
    comments: {
      items: {
        additionalProperties: false,
        properties: {
          body: { type: 'string' },
          hunkId: { type: 'string' },
          line: { type: 'integer' },
          severity: { enum: [...SEVERITIES], type: 'string' },
          side: { enum: ['additions', 'deletions'], type: 'string' },
        },
        required: ['hunkId', 'side', 'line', 'severity', 'body'],
        type: 'object',
      },
      maxItems: MAX_REVIEW_COMMENTS,
      type: 'array',
    },
    summary: { type: 'string' },
    version: { const: 1, type: 'number' },
  },
  required: ['version', 'summary', 'comments'],
  type: 'object',
};

/**
 * Renders a hunk with explicit line numbers so the agent can cite a line
 * without counting from the hunk header. `+`/`-`/` ` keep the diff meaning;
 * context lines carry their new-file number.
 *
 * @param {SectionHunk} hunk
 */
const numberHunkLines = (hunk) => {
  const lines = (hunk.patch || '').split('\n');
  let deletionLine = hunk.deletionStart ?? 0;
  let additionLine = hunk.additionStart ?? 0;
  /** @type {Array<string>} */
  const numbered = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('+')) {
      numbered.push(`+${additionLine} | ${line.slice(1)}`);
      additionLine += 1;
    } else if (line.startsWith('-')) {
      numbered.push(`-${deletionLine} | ${line.slice(1)}`);
      deletionLine += 1;
    } else if (line.startsWith(' ')) {
      numbered.push(` ${additionLine} | ${line.slice(1)}`);
      additionLine += 1;
      deletionLine += 1;
    }
  }
  return numbered.join('\n');
};

/**
 * Lines a comment may target: changed lines on their own side, and context
 * lines on the additions side, matching where the diff view renders comments.
 * A comment on any other line falls back to the hunk's first change.
 *
 * @param {SectionHunk} hunk
 */
const getCommentableLines = (hunk) => {
  /** @type {Set<number>} */
  const additions = new Set();
  /** @type {Set<number>} */
  const deletions = new Set();
  /** @type {CommentTarget | null} */
  let firstChange = null;
  let deletionLine = hunk.deletionStart ?? 0;
  let additionLine = hunk.additionStart ?? 0;
  for (const line of (hunk.patch || '').split('\n').slice(1)) {
    if (line.startsWith('+')) {
      firstChange ??= { line: additionLine, side: 'additions' };
      additions.add(additionLine);
      additionLine += 1;
    } else if (line.startsWith('-')) {
      firstChange ??= { line: deletionLine, side: 'deletions' };
      deletions.add(deletionLine);
      deletionLine += 1;
    } else if (line.startsWith(' ')) {
      additions.add(additionLine);
      additionLine += 1;
      deletionLine += 1;
    }
  }
  return { additions, deletions, firstChange };
};

/** @param {RepositoryState} state */
const getReviewableHunks = (state) =>
  state.files.flatMap((file) =>
    isGeneratedWalkthroughFile(file)
      ? []
      : file.sections.flatMap((section) =>
          getSectionWalkthroughHunks(file, section).filter(
            (hunk) => !isSyntheticWalkthroughHunk(hunk),
          ),
        ),
  );

/** @param {RepositoryState} state */
const buildAgentReviewInput = (state) => {
  const hunks = getReviewableHunks(state);
  /** @type {Map<string, IndexedHunk>} */
  const hunkByAlias = new Map();
  let remainingBudget = MAX_TOTAL_PATCH_CHARS;
  let omittedHunks = 0;

  const files = [];
  /** @type {Map<string, {path: string; oldPath?: string; status: string; hunks: Array<unknown>}>} */
  const fileByPath = new Map();
  hunks.forEach((hunk, index) => {
    const alias = `h${index + 1}`;
    const fairBudget = Math.min(
      MAX_HUNK_PATCH_CHARS,
      Math.floor(remainingBudget / (hunks.length - index)),
    );
    const numbered = numberHunkLines(hunk);
    if (numbered.length > fairBudget) {
      omittedHunks += 1;
      return;
    }
    remainingBudget -= numbered.length;
    hunkByAlias.set(alias, { hunk, lines: getCommentableLines(hunk) });

    let file = fileByPath.get(hunk.path);
    if (!file) {
      file = {
        ...(hunk.oldPath && hunk.oldPath !== hunk.path ? { oldPath: hunk.oldPath } : {}),
        hunks: [],
        path: hunk.path,
        status: hunk.status,
      };
      fileByPath.set(hunk.path, file);
      files.push(file);
    }
    file.hunks.push({ id: alias, lines: numbered });
  });

  return {
    hunkByAlias,
    input: {
      branch: state.branch,
      files,
      ...(omittedHunks > 0 ? { omittedHunks } : {}),
      source:
        state.source.type === 'pull-request' && typeof state.source.description === 'string'
          ? {
              ...state.source,
              description: truncate(state.source.description, MAX_SOURCE_DESCRIPTION_CHARS),
            }
          : state.source,
    },
  };
};

/** @param {unknown} input @param {string} agentLabel */
const buildAgentReviewPrompt = (
  input,
  agentLabel,
) => `You are ${agentLabel} inside Codiff, reviewing a code change.

The reviewer asked you to review the diff below and leave inline review comments.
Use only the diff below; do not inspect the repository or run shell commands.
If source.description is present, treat it as the author's intent, not proof of behavior.

Each hunk has an id and numbered lines:
- "+N | code" is an added line N in the new file (side "additions").
- "-N | code" is a removed line N in the old file (side "deletions").
- " N | code" is an unchanged context line N in the new file (side "additions").

Write comments a strong senior reviewer would leave:
- Focus on correctness bugs, regressions, security problems, data loss, race conditions, missing error handling, and confusing or risky design.
- Each comment must point at the exact line it is about: its hunk id, side, and line number as shown.
- Explain the concrete problem and, when you can, the fix. Keep each comment under 120 words. Markdown is allowed.
- severity: "blocker" must be fixed before merging, "issue" is a real problem, "suggestion" is an improvement, "question" asks the author something the diff cannot answer, "nit" is minor style.
- Do not comment on formatting a linter would catch, do not restate what the code does, and do not praise.
- Do not invent problems. An empty comments array is a good answer for a clean change.
- Hunk ids are internal to Codiff: never mention them in a comment body. Refer to files, symbols, and line numbers instead.
- Do not ask the author to verify code that is not in the diff, and do not comment on hunks that were omitted for size (omittedHunks).
- Leave at most ${MAX_REVIEW_COMMENTS} comments, most important first.
- summary: one or two sentences with your overall verdict.

Diff:
${JSON.stringify(input, null, 2)}
`;

/** @param {unknown} value */
const cleanBody = (value) =>
  (typeof value === 'string' ? value : '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Agents sometimes cite hunks as "(h18)" despite the prompt; swap those for
 * the file path the reviewer can see.
 *
 * @param {string} body
 * @param {ReadonlyMap<string, IndexedHunk>} hunkByAlias
 */
const replaceHunkAliases = (body, hunkByAlias) =>
  body.replace(/\((h\d+)(?::\d+)?\)/g, (match, alias) => {
    const path = hunkByAlias.get(alias)?.hunk.path;
    return path ? `(\`${path}\`)` : match;
  });

/**
 * Anchors the agent's comments to real diff lines, dropping comments on
 * unknown hunks.
 *
 * @param {unknown} parsed
 * @param {ReadonlyMap<string, IndexedHunk>} hunkByAlias
 * @returns {{comments: Array<AgentReviewComment>; summary: string}}
 */
const normalizeAgentReview = (parsed, hunkByAlias) => {
  const record = parsed && typeof parsed === 'object' ? /** @type {any} */ (parsed) : {};
  /** @type {Array<AgentReviewComment>} */
  const comments = [];
  for (const raw of Array.isArray(record.comments) ? record.comments : []) {
    const indexed = hunkByAlias.get(typeof raw?.hunkId === 'string' ? raw.hunkId.trim() : '');
    const body = replaceHunkAliases(cleanBody(raw?.body), hunkByAlias);
    if (!indexed || !body) {
      continue;
    }

    const requestedSide = raw.side === 'deletions' ? 'deletions' : 'additions';
    const target =
      Number.isInteger(raw.line) && indexed.lines[requestedSide].has(raw.line)
        ? { line: /** @type {number} */ (raw.line), side: requestedSide }
        : indexed.lines.firstChange;
    if (!target) {
      continue;
    }

    comments.push({
      body,
      filePath: indexed.hunk.path,
      lineNumber: target.line,
      sectionId: indexed.hunk.sectionId,
      severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'suggestion',
      side: target.side,
    });
    if (comments.length >= MAX_REVIEW_COMMENTS) {
      break;
    }
  }

  return { comments, summary: cleanBody(record.summary) };
};

/**
 * @param {RepositoryState} state
 * @param {Agent} agent
 * @param {AgentOptions} agentOptions
 * @returns {Promise<AgentReviewResult>}
 */
const readAgentReview = async (state, agent, agentOptions) => {
  const { hunkByAlias, input } = buildAgentReviewInput(state);
  if (hunkByAlias.size === 0) {
    return { comments: [], status: 'ready', summary: 'There are no reviewable text changes.' };
  }

  try {
    const response = await agent.run(
      state.root,
      buildAgentReviewPrompt(input, agent.label),
      agentReviewSchema,
      'agent-review.json',
      `${agent.label} review timed out.`,
      {
        ...agentOptions,
        timeoutMs: Math.min(
          MAX_TIMEOUT_MS,
          Math.max(
            agent.defaultTimeoutMs,
            BASE_TIMEOUT_MS + hunkByAlias.size * TIMEOUT_MS_PER_HUNK,
          ),
        ),
      },
    );
    return { ...normalizeAgentReview(parseJSONMessage(response), hunkByAlias), status: 'ready' };
  } catch (error) {
    return {
      ...(agent.isNotFoundError(error) ? { code: agent.notFoundCode } : {}),
      reason: error instanceof Error ? error.message : String(error),
      status: 'unavailable',
    };
  }
};

module.exports = {
  agentReviewSchema,
  buildAgentReviewInput,
  buildAgentReviewPrompt,
  normalizeAgentReview,
  readAgentReview,
};
