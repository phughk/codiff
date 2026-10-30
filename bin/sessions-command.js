import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { replyToSessionComment, requestSessions } = require('../electron/codiff-sessions.cjs');

const agentIds = new Set(['claude', 'codex', 'opencode', 'pi']);

const helpText = `Usage:
  codiff sessions [path]
  codiff sessions reply [--agent <claude|codex|opencode|pi>] <session-id> <comment-id> [body]

Session comments are notes left in Codiff for an agent, marked with the Session
button on a comment. They stay out of copied comments and pull request reviews.

The first form prints the session comments of every open Codiff window as JSON.
Pass a path to only include windows reviewing that repository.

Output: {"running": boolean, "sessions": [{"id", "title", "repositoryRoot",
"source", "responded", "comments": [{"id", "filePath", "location", "anchor",
"lineNumber", "side", "startLineNumber", "startSide", "body", "diff",
"replies": [{"agentId", "body", "createdAt"}]}]}]}

"reply" posts a Markdown reply under one comment, using the session "id" and the
comment "id" from that output. The body is read from stdin when omitted or "-".
`;

/** @param {string} path */
const getRealPath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** @param {string} path */
const resolveRepositoryRoot = (path) => {
  try {
    return getRealPath(
      execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return getRealPath(path);
  }
};

/** @param {AsyncIterable<string | Buffer>} stdin */
const readStream = async (stdin) => {
  let text = '';
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
};

/**
 * @param {ReadonlyArray<string>} args
 * @param {{
 *   replyToSessionComment?: typeof replyToSessionComment;
 *   requestSessions?: typeof requestSessions;
 *   stderr?: {write: (text: string) => unknown};
 *   stdin?: AsyncIterable<string | Buffer>;
 *   stdout?: {write: (text: string) => unknown};
 * }} [options]
 * @returns {Promise<number>} exit code
 */
export const runSessionsCommand = async (
  args,
  {
    replyToSessionComment: reply = replyToSessionComment,
    requestSessions: request = requestSessions,
    stderr = process.stderr,
    stdin = process.stdin,
    stdout = process.stdout,
  } = {},
) => {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args: [...args],
      options: { agent: { type: 'string' }, help: { short: 'h', type: 'boolean' } },
    });
  } catch (error) {
    stderr.write(
      `codiff sessions: ${error instanceof Error ? error.message : error}\n\n${helpText}`,
    );
    return 1;
  }

  if (parsed.values.help) {
    stdout.write(helpText);
    return 0;
  }

  /** @param {unknown} error */
  const fail = (error) => {
    stderr.write(
      `codiff sessions: ${error instanceof Error ? error.message : 'Codiff could not be reached.'}\n`,
    );
    return 1;
  };

  const [command, ...rest] = parsed.positionals;
  if (command === 'reply') {
    const [sessionId, commentId, ...bodyParts] = rest;
    const agentId = parsed.values.agent;
    if (
      !sessionId ||
      !/^\d+$/.test(sessionId) ||
      !commentId ||
      (agentId != null && !agentIds.has(agentId))
    ) {
      stderr.write(helpText);
      return 1;
    }

    const body = (
      bodyParts.length === 0 || (bodyParts.length === 1 && bodyParts[0] === '-')
        ? await readStream(stdin)
        : bodyParts.join(' ')
    ).trim();
    if (!body) {
      return fail(new Error('The reply is empty.'));
    }

    try {
      const running = await reply({
        ...(agentId ? { agentId } : {}),
        body,
        commentId,
        sessionId: Number(sessionId),
      });
      if (!running) {
        return fail(new Error('Codiff is not running.'));
      }
    } catch (error) {
      return fail(error);
    }
    stdout.write(`${JSON.stringify({ status: 'ok' })}\n`);
    return 0;
  }

  if (parsed.values.agent != null || parsed.positionals.length > 1) {
    stderr.write(helpText);
    return 1;
  }

  let response;
  try {
    response = await request();
  } catch (error) {
    return fail(error);
  }

  const repositoryRoot = command ? resolveRepositoryRoot(command) : null;
  const sessions = (response?.sessions ?? []).filter(
    (session) =>
      !repositoryRoot ||
      (typeof session?.repositoryRoot === 'string' &&
        getRealPath(session.repositoryRoot) === repositoryRoot),
  );

  stdout.write(`${JSON.stringify({ running: response != null, sessions }, null, 2)}\n`);
  return 0;
};
