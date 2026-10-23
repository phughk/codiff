// @ts-check

const { mkdirSync, rmSync } = require('node:fs');
const { createConnection, createServer } = require('node:net');
const { homedir, userInfo } = require('node:os');
const { dirname, join } = require('node:path');

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * @typedef {{type: 'list'}} CodiffSessionsRequest
 * @typedef {{sessions: ReadonlyArray<unknown>}} CodiffSessionsResponse
 */

/**
 * The running app listens here so `codiff-sessions` can read draft comments from
 * every open window. Lives next to `~/.codiff/codiff.jsonc` so agent sandboxes that
 * rewrite `TMPDIR` still find it.
 */
const getSessionsSocketPath = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\codiff-sessions-${userInfo().username}`
    : join(homedir(), '.codiff', 'sessions.sock');

/**
 * @param {{
 *   listSessions: () => Promise<ReadonlyArray<unknown>>;
 *   socketPath?: string;
 * }} options
 */
const startSessionsServer = ({ listSessions, socketPath = getSessionsSocketPath() }) => {
  const isPipe = socketPath.startsWith('\\\\.\\pipe\\');
  if (!isPipe) {
    mkdirSync(dirname(socketPath), { recursive: true });
    // Only one Codiff instance runs at a time, so any existing socket is stale.
    rmSync(socketPath, { force: true });
  }

  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        return;
      }

      socket.removeAllListeners('data');
      /** @type {Partial<CodiffSessionsRequest> | null} */
      let request = null;
      try {
        request = JSON.parse(buffer.slice(0, newline));
      } catch {}

      if (request?.type !== 'list') {
        socket.end(`${JSON.stringify({ error: 'Unsupported request.' })}\n`);
        return;
      }

      listSessions().then(
        (sessions) => socket.end(`${JSON.stringify({ sessions })}\n`),
        (error) =>
          socket.end(
            `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
          ),
      );
    });
  });

  server.on('error', () => {});
  server.listen(socketPath);

  return {
    close: () => {
      server.close();
      if (!isPipe) {
        rmSync(socketPath, { force: true });
      }
    },
  };
};

/**
 * Resolves `null` when no Codiff app is listening.
 * @param {{socketPath?: string; timeoutMs?: number}} [options]
 * @returns {Promise<CodiffSessionsResponse | null>}
 */
const requestSessions = ({
  socketPath = getSessionsSocketPath(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) =>
  new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('Codiff did not respond in time.'));
    });
    socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'list' })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
    });
    socket.on('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        resolve(null);
        return;
      }
      reject(error);
    });
    socket.on('end', () => {
      try {
        const response = JSON.parse(buffer);
        if (typeof response?.error === 'string') {
          reject(new Error(response.error));
          return;
        }
        resolve({ sessions: Array.isArray(response?.sessions) ? response.sessions : [] });
      } catch {
        reject(new Error('Codiff returned an invalid response.'));
      }
    });
  });

module.exports = { getSessionsSocketPath, requestSessions, startSessionsServer };
