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
 * @typedef {'additions' | 'deletions'} Side
 * @typedef {{line: number; side: Side; text: string}} DiffLine
 * @typedef {{hunk: SectionHunk; lines: ReadonlyArray<DiffLine>}} IndexedHunk
 */

const MAX_TOTAL_PATCH_CHARS = 160_000;
const MAX_HUNK_PATCH_CHARS = 60_000;
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
          line: { type: 'integer' },
          lineText: { type: 'string' },
          path: { type: 'string' },
          severity: { enum: [...SEVERITIES], type: 'string' },
          side: { enum: ['additions', 'deletions'], type: 'string' },
        },
        required: ['path', 'side', 'line', 'lineText', 'severity', 'body'],
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
 * The lines of a hunk with the line number and side a comment on each one
 * uses: changed lines on their own side, and context lines on the additions
 * side, matching where the diff view renders comments.
 *
 * @param {SectionHunk} hunk
 * @returns {Array<DiffLine & {prefix: '+' | '-' | ' '}>}
 */
const readHunkLines = (hunk) => {
  let deletionLine = hunk.deletionStart ?? 0;
  let additionLine = hunk.additionStart ?? 0;
  /** @type {Array<DiffLine & {prefix: '+' | '-' | ' '}>} */
  const lines = [];
  for (const line of (hunk.patch || '').split('\n').slice(1)) {
    const text = line.slice(1);
    if (line.startsWith('+')) {
      lines.push({ line: additionLine, prefix: '+', side: 'additions', text });
      additionLine += 1;
    } else if (line.startsWith('-')) {
      lines.push({ line: deletionLine, prefix: '-', side: 'deletions', text });
      deletionLine += 1;
    } else if (line.startsWith(' ')) {
      lines.push({ line: additionLine, prefix: ' ', side: 'additions', text });
      additionLine += 1;
      deletionLine += 1;
    }
  }
  return lines;
};

/**
 * Renders a hunk with explicit line numbers so the agent can cite a line
 * without counting from the hunk header.
 *
 * @param {ReturnType<typeof readHunkLines>} lines
 */
const formatHunkLines = (lines) =>
  lines.map(({ line, prefix, text }) => `${prefix}${line} | ${text}`).join('\n');

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
  /** @type {Map<string, Array<IndexedHunk>>} */
  const hunksByPath = new Map();
  /** @type {Array<string>} */
  const diff = [];
  let hunkCount = 0;
  let omittedHunks = 0;
  let remainingBudget = MAX_TOTAL_PATCH_CHARS;
  let previousPath = null;

  const renderedHunks = hunks.map((hunk) => {
    const lines = readHunkLines(hunk);
    return { formatted: formatHunkLines(lines), hunk, lines };
  });
  // Budget the smallest hunks first so one large hunk cannot crowd out many
  // small ones, then keep diff order in the prompt.
  const included = new Set();
  const bySize = [...renderedHunks].sort((a, b) => a.formatted.length - b.formatted.length);
  bySize.forEach((rendered, index) => {
    const fairBudget = Math.min(
      MAX_HUNK_PATCH_CHARS,
      Math.floor(remainingBudget / (bySize.length - index)),
    );
    if (rendered.formatted.length <= fairBudget) {
      included.add(rendered);
      remainingBudget -= rendered.formatted.length;
    }
  });

  for (const rendered of renderedHunks) {
    const { formatted, hunk, lines } = rendered;
    if (!included.has(rendered)) {
      omittedHunks += 1;
      continue;
    }
    hunkCount += 1;

    const fileHunks = hunksByPath.get(hunk.path) ?? [];
    fileHunks.push({ hunk, lines });
    hunksByPath.set(hunk.path, fileHunks);

    if (hunk.path !== previousPath) {
      const renamed = hunk.oldPath && hunk.oldPath !== hunk.path ? `, from ${hunk.oldPath}` : '';
      diff.push(`=== ${hunk.path} (${hunk.status}${renamed}) ===`);
      previousPath = hunk.path;
    }
    diff.push(`${hunk.header ?? '@@'}\n${formatted}`);
  }

  return {
    diff: diff.join('\n\n'),
    hunkCount,
    hunksByPath,
    metadata: {
      branch: state.branch,
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

/** @param {unknown} customPrompt */
const buildCustomPromptInput = (customPrompt) => {
  const prompt = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  return prompt
    ? `
Custom review instructions from the reviewer:
${prompt}

Follow these instructions for what to focus on, what to skip, and tone. If they conflict with the output rules above (anchoring comments on path, side, line, and lineText, or the JSON schema), keep those rules.
`
    : '';
};

/**
 * @param {ReturnType<typeof buildAgentReviewInput>} input
 * @param {string} agentLabel
 * @param {unknown} [customPrompt]
 */
const buildAgentReviewPrompt = (
  input,
  agentLabel,
  customPrompt,
) => `You are ${agentLabel} inside Codiff, reviewing a code change.

The reviewer asked you to review the diff below and leave inline review comments.
Use only the diff below; do not inspect the repository or run shell commands.
If source.description is present, treat it as the author's intent, not proof of behavior.

Each file starts with "=== path (status) ===", followed by its hunks. Every diff line is numbered:
- "+N | code" is an added line N in the new file (side "additions").
- "-N | code" is a removed line N in the old file (side "deletions").
- " N | code" is an unchanged context line N in the new file (side "additions").

Write comments a strong senior reviewer would leave:
- Focus on correctness bugs, regressions, security problems, data loss, race conditions, missing error handling, and confusing or risky design.
- Anchor each comment on the line it is about: the file's path exactly as in its "===" heading, the side and line number shown before "|", and lineText, the code after "| " copied exactly. The comment must be about that line or the code right around it, in that same file.
- Explain the concrete problem and, when you can, the fix. Keep each comment under 120 words. Markdown is allowed.
- severity: "blocker" must be fixed before merging, "issue" is a real problem, "suggestion" is an improvement, "question" asks the author something the diff cannot answer, "nit" is minor style.
- Do not comment on formatting a linter would catch, do not restate what the code does, and do not praise.
- Do not invent problems. An empty comments array is a good answer for a clean change.
- Do not ask the author to verify code that is not in the diff. Some hunks may be omitted for size (metadata.omittedHunks); do not guess about them.
- Leave at most ${MAX_REVIEW_COMMENTS} comments, most important first.
- summary: one or two sentences with your overall verdict.
${buildCustomPromptInput(customPrompt)}
Metadata:
${JSON.stringify(input.metadata, null, 2)}

Diff:
${input.diff}
`;

/** @param {unknown} value */
const cleanBody = (value) =>
  (typeof value === 'string' ? value : '').replace(/\n{3,}/g, '\n\n').trim();

/** @param {unknown} value */
const normalizeCode = (value) =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : '';

/**
 * @param {ReadonlyMap<string, ReadonlyArray<IndexedHunk>>} hunksByPath
 * @param {unknown} value
 */
const findFileHunks = (hunksByPath, value) => {
  const path = typeof value === 'string' ? value.trim().replace(/^(?:[ab]\/|\.\/)/, '') : '';
  if (!path) {
    return null;
  }
  const exact = hunksByPath.get(path);
  if (exact) {
    return exact;
  }
  const suffixMatches = [...hunksByPath.keys()].filter(
    (candidate) => candidate.endsWith(`/${path}`) || path.endsWith(`/${candidate}`),
  );
  return suffixMatches.length === 1 ? (hunksByPath.get(suffixMatches[0]) ?? null) : null;
};

/**
 * Finds the diff line a comment is about. The quoted line text wins over the
 * line number, since agents copy code more reliably than they count lines; a
 * comment that matches neither is dropped rather than placed on a guess.
 *
 * @param {ReadonlyArray<IndexedHunk>} fileHunks
 * @param {any} raw
 * @returns {{hunk: SectionHunk; line: DiffLine} | null}
 */
const resolveCommentLine = (fileHunks, raw) => {
  const side = raw?.side === 'deletions' ? 'deletions' : 'additions';
  const requestedLine = Number.isInteger(raw?.line) ? raw.line : null;
  const text = normalizeCode(raw?.lineText);
  const candidates = fileHunks.flatMap(({ hunk, lines }) => lines.map((line) => ({ hunk, line })));

  const numbered = candidates.find(({ line }) => line.side === side && line.line === requestedLine);
  if (!text || (numbered && normalizeCode(numbered.line.text) === text)) {
    return numbered ?? null;
  }

  const textMatches = candidates.filter(({ line }) => normalizeCode(line.text) === text);
  if (textMatches.length > 0) {
    const distance = (/** @type {{line: DiffLine}} */ { line }) =>
      (line.side === side ? 0 : 1_000_000) + Math.abs(line.line - (requestedLine ?? line.line));
    return textMatches.reduce((best, match) => (distance(match) < distance(best) ? match : best));
  }

  return numbered ?? null;
};

/**
 * Anchors the agent's comments to real diff lines, dropping comments that
 * cannot be placed.
 *
 * @param {unknown} parsed
 * @param {ReadonlyMap<string, ReadonlyArray<IndexedHunk>>} hunksByPath
 * @returns {{comments: Array<AgentReviewComment>; summary: string}}
 */
const normalizeAgentReview = (parsed, hunksByPath) => {
  const record = parsed && typeof parsed === 'object' ? /** @type {any} */ (parsed) : {};
  /** @type {Array<AgentReviewComment>} */
  const comments = [];
  for (const raw of Array.isArray(record.comments) ? record.comments : []) {
    const body = cleanBody(raw?.body);
    const fileHunks = findFileHunks(hunksByPath, raw?.path);
    const target = body && fileHunks ? resolveCommentLine(fileHunks, raw) : null;
    if (!target) {
      continue;
    }

    comments.push({
      body,
      filePath: target.hunk.path,
      lineNumber: target.line.line,
      sectionId: target.hunk.sectionId,
      severity: SEVERITIES.includes(raw.severity) ? raw.severity : 'suggestion',
      side: target.line.side,
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
 * @param {unknown} [customPrompt] The reviewer's `settings.reviewPrompt`.
 * @returns {Promise<AgentReviewResult>}
 */
const readAgentReview = async (state, agent, agentOptions, customPrompt) => {
  const input = buildAgentReviewInput(state);
  if (input.hunkCount === 0) {
    return {
      agentId: agent.id,
      comments: [],
      status: 'ready',
      summary: 'There are no reviewable text changes.',
    };
  }

  try {
    const response = await agent.run(
      state.root,
      buildAgentReviewPrompt(input, agent.label, customPrompt),
      agentReviewSchema,
      'agent-review.json',
      `${agent.label} review timed out.`,
      {
        ...agentOptions,
        timeoutMs: Math.min(
          MAX_TIMEOUT_MS,
          Math.max(agent.defaultTimeoutMs, BASE_TIMEOUT_MS + input.hunkCount * TIMEOUT_MS_PER_HUNK),
        ),
      },
    );
    return {
      agentId: agent.id,
      ...normalizeAgentReview(parseJSONMessage(response), input.hunksByPath),
      status: 'ready',
    };
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
