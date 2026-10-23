import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { requestSessions } = require('../electron/codiff-sessions.cjs');

const helpText = `Usage: codiff-sessions [path]

Print the outstanding (unsubmitted draft) review comments of every open Codiff
window as JSON. Pass a path to only include windows reviewing that repository.

Output: {"running": boolean, "sessions": [{"id", "title", "repositoryRoot",
"source", "responded", "comments": [{"id", "filePath", "location", "anchor",
"lineNumber", "side", "startLineNumber", "startSide", "body", "diff"}]}]}
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

/**
 * @param {ReadonlyArray<string>} args
 * @param {{requestSessions?: typeof requestSessions; stdout?: {write: (text: string) => unknown}; stderr?: {write: (text: string) => unknown}}} [options]
 * @returns {Promise<number>} exit code
 */
export const runSessionsCommand = async (
  args,
  {
    requestSessions: request = requestSessions,
    stderr = process.stderr,
    stdout = process.stdout,
  } = {},
) => {
  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(helpText);
    return 0;
  }

  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (positional.length > 1 || positional.length !== args.length) {
    stderr.write(helpText);
    return 1;
  }

  let response;
  try {
    response = await request();
  } catch (error) {
    stderr.write(
      `codiff-sessions: ${error instanceof Error ? error.message : 'Codiff could not be reached.'}\n`,
    );
    return 1;
  }

  const repositoryRoot = positional[0] ? resolveRepositoryRoot(positional[0]) : null;
  const sessions = (response?.sessions ?? []).filter(
    (session) =>
      !repositoryRoot ||
      (typeof session?.repositoryRoot === 'string' &&
        getRealPath(session.repositoryRoot) === repositoryRoot),
  );

  stdout.write(`${JSON.stringify({ running: response != null, sessions }, null, 2)}\n`);
  return 0;
};
