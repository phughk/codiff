// @ts-check

const { parseJSONMessage, truncate } = require('./agent-shared.cjs');

const MAX_PATCH_CHARS = 24_000;
const MAX_OTHER_FILES = 40;
const MAX_SOURCE_DESCRIPTION_CHARS = 4_000;
const MAX_CONVERSATION_TURNS = 20;
const MAX_TURN_CHARS = 4_000;
const MAX_ACTIVITY_STEPS = 200;
// Investigating means several tool calls before answering, so give it room.
const INVESTIGATION_TIMEOUT_MS = 300_000;

/**
 * @typedef {import('../core/types.ts').AgentActivity} AgentActivity
 * @typedef {import('../core/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('../core/types.ts').ReviewAssistantRequest} ReviewAssistantRequest
 * @typedef {import('./agent.cjs').Agent} Agent
 * @typedef {import('./agent.cjs').AgentOptions} AgentOptions
 */

const reviewAssistantSchema = {
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    version: { const: 1, type: 'number' },
  },
  required: ['version', 'reply'],
  type: 'object',
};

/** @param {ChangedFile} file */
const getFileDigest = (file) => ({
  oldPath: file.oldPath,
  path: file.path,
  status: file.status,
  summaries: file.sections
    .map((section) => section.summary?.reason)
    .filter((summary) => typeof summary === 'string' && summary.trim()),
});

/** @param {Partial<ReviewAssistantRequest> | null | undefined} request */
const getConversationInput = (request) => {
  const followUp = typeof request?.followUp === 'string' ? request.followUp.trim() : '';
  if (!followUp) {
    return {};
  }
  const conversation = (Array.isArray(request?.conversation) ? request.conversation : [])
    .filter(
      (turn) =>
        (turn?.role === 'agent' || turn?.role === 'reviewer') &&
        typeof turn.body === 'string' &&
        turn.body.trim(),
    )
    .slice(-MAX_CONVERSATION_TURNS)
    .map((turn) => ({ body: truncate(turn.body.trim(), MAX_TURN_CHARS), role: turn.role }));
  return { conversation, followUp: truncate(followUp, MAX_TURN_CHARS) };
};

/** @param {RepositoryState} state @param {Partial<ReviewAssistantRequest> | null | undefined} request */
const buildReviewAssistantInput = (state, request) => {
  /** @type {Partial<ReviewAssistantRequest['comment']>} */
  const comment = request?.comment ?? {};
  const file = state.files.find((candidate) => candidate.path === comment.filePath);
  const section = file?.sections.find((candidate) => candidate.id === comment.sectionId);

  return {
    comment: {
      anchor: comment.anchor,
      body: typeof comment.body === 'string' ? comment.body : '',
      filePath: comment.filePath,
      lineNumber: comment.lineNumber,
      side: comment.side,
      startLineNumber: comment.startLineNumber,
      startSide: comment.startSide,
    },
    focus: file
      ? {
          file: getFileDigest(file),
          patchExcerpt: section
            ? truncate(section.patch || section.summary?.reason || '', MAX_PATCH_CHARS)
            : 'No patch context available.',
          section: section
            ? {
                binary: section.binary,
                kind: section.kind,
                loadState: section.loadState,
                summary: section.summary?.reason,
              }
            : null,
        }
      : null,
    nearbyFiles: state.files
      .filter((candidate) => candidate.path !== comment.filePath)
      .slice(0, MAX_OTHER_FILES)
      .map(getFileDigest),
    root: state.root,
    ...getConversationInput(request),
    source:
      state.source.type === 'pull-request' && typeof state.source.description === 'string'
        ? {
            ...state.source,
            description: truncate(state.source.description, MAX_SOURCE_DESCRIPTION_CHARS),
          }
        : state.source,
    walkthroughNote: request?.walkthroughNote ?? null,
  };
};

/** @param {string | null | undefined} workspaceRoot */
const getInvestigationInstructions = (workspaceRoot) =>
  workspaceRoot
    ? `
You can investigate before answering. Your working directory is a read-only checkout of the code under review (${workspaceRoot}), at the head of the change. Read files, search the code, list directories, and use read-only git commands (\`git log\`, \`git show\`, \`git blame\`, \`git diff\`, \`git grep\`) to answer questions the digest alone cannot: callers and callees, how a changed function is used elsewhere, surrounding code, history, and wider design questions.
- Start from the digest and only investigate what the question needs. Small questions about the visible patch need no tool calls.
- Make as many targeted tool calls as the question needs, then stop and answer.
- Never modify files, install packages, or access the network.
- Cite the code you rely on as \`path:line\` so the reviewer can check it.
`
    : `
Use only the repository change digest below; do not inspect the repository or run shell commands.
`;

/**
 * @param {RepositoryState} state
 * @param {Partial<ReviewAssistantRequest> | null | undefined} request
 * @param {string} [agentLabel]
 * @param {string | null} [workspaceRoot]
 */
const buildReviewAssistantPrompt = (
  state,
  request,
  agentLabel = 'Codex',
  workspaceRoot = null,
) => `You are ${agentLabel} inside Codiff.

A human reviewer wrote an inline review note or question and clicked Ask ${agentLabel}.
Reply as a concise assistant in the same inline conversation.
${getInvestigationInstructions(workspaceRoot)}
If there is walkthrough context, use it as review orientation, not as proof.
If source.description is present, treat it as author-written PR/MR intent and orientation, not proof of behavior. The changed files and patch excerpt remain the source of truth for what changed.
You are the code-review expert in this conversation, so explain the change directly.
${
  getConversationInput(request).followUp
    ? `
The reviewer is continuing the conversation. The digest's conversation lists your earlier replies ("agent") and the reviewer's follow-ups ("reviewer") after the original note, oldest first; followUp is the reviewer's newest message.
Answer followUp directly. Build on what was already said instead of repeating it, and correct an earlier reply if the diff shows it was wrong.
`
    : ''
}
Your job:
- Turn vague unease into coherent, actionable review feedback.
- If the note asks "why", explain why this change is needed based on the diff.
- If useful, suggest a clearer review comment the human could use.
- Prefer questions and concrete risks over accusations.
- Do not hedge. Avoid words and phrases like "appears", "seems", "might", "likely", "probably", "I think", "I suspect", and "the intent".
- Say "This change introduces...", "This change moves...", or "This is needed because..." instead of "This change appears to...".
- Lead with the direct answer in the first sentence, then the supporting evidence. Do not narrate your investigation steps.
- If the evidence is not enough, state the concrete uncertainty after the explanation.
- Do not say the change is correct unless the evidence proves it.
- Do not invent bugs, unstated requirements, or files${workspaceRoot ? ' you did not read' : ' outside the digest'}.
- Keep the reply under ${workspaceRoot ? '300' : '180'} words.
- Markdown is allowed.

Repository change digest:
${JSON.stringify(buildReviewAssistantInput(state, request), null, 2)}
`;

/** @param {unknown} value @param {string} [fallback] */
const cleanReply = (value, fallback = '') =>
  (typeof value === 'string' ? value : fallback).replace(/\n{3,}/g, '\n\n').trim();

/** @param {unknown} input @param {string} [agentLabel] */
const normalizeReviewAssistantReply = (input, agentLabel = 'Codex') => ({
  reply: cleanReply(
    input && typeof input === 'object' && 'reply' in input ? input.reply : undefined,
    `${agentLabel} could not produce a useful reply.`,
  ),
  version: 1,
});

/**
 * Answers a reviewer's note. With `workspaceRoot`, the agent runs there with
 * read-only tools so it can investigate beyond the diff, and reports each step
 * through `onActivity`.
 *
 * @param {RepositoryState} state
 * @param {ReviewAssistantRequest} request
 * @param {Agent} agent
 * @param {AgentOptions} agentOptions
 * @param {{onActivity?: (activity: AgentActivity) => void; workspaceRoot?: string | null}} [investigation]
 */
const readReviewAssistantReply = async (
  state,
  request,
  agent,
  agentOptions,
  { onActivity, workspaceRoot = null } = {},
) => {
  /** @type {Array<AgentActivity>} */
  const activity = [];
  try {
    const response = await agent.run(
      workspaceRoot || state.root,
      buildReviewAssistantPrompt(state, request, agent.label, workspaceRoot),
      reviewAssistantSchema,
      'review-assistant.json',
      `${agent.label} review reply timed out.`,
      workspaceRoot
        ? {
            ...agentOptions,
            investigate: true,
            onActivity: (step) => {
              if (activity.length < MAX_ACTIVITY_STEPS) {
                activity.push(step);
                onActivity?.(step);
              }
            },
            timeoutMs: Math.max(
              agentOptions.timeoutMs ?? agent.defaultTimeoutMs ?? 0,
              INVESTIGATION_TIMEOUT_MS,
            ),
          }
        : agentOptions,
    );
    const parsed = parseJSONMessage(response);

    return {
      ...(activity.length > 0 ? { activity } : {}),
      reply: normalizeReviewAssistantReply(parsed, agent.label).reply,
      status: 'ready',
    };
  } catch (error) {
    if (agent.isNotFoundError(error)) {
      return {
        code: agent.notFoundCode,
        reason: error instanceof Error ? error.message : String(error),
        status: 'unavailable',
      };
    }

    return {
      reason: error instanceof Error ? error.message : String(error),
      status: 'unavailable',
    };
  }
};

module.exports = { buildReviewAssistantPrompt, readReviewAssistantReply };
