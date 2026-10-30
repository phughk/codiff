// @ts-check

const { mkdirSync, rmSync } = require('node:fs');
const { createConnection, createServer } = require('node:net');
const { homedir, userInfo } = require('node:os');
const { dirname, join } = require('node:path');

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const MAX_REQUEST_BYTES = 1024 * 1024;

/**
 * @typedef {{type: 'list'}} CodiffSessionsListRequest
 * @typedef {{
 *   agentId?: string;
 *   body: string;
 *   commentId: string;
 *   sessionId: number;
 *   type: 'reply';
 * }} CodiffSessionsReplyRequest
 * @typedef {CodiffSessionsListRequest | CodiffSessionsReplyRequest} CodiffSessionsRequest
 * @typedef {{sessions: ReadonlyArray<unknown>}} CodiffSessionsResponse
 */

/**
 * The running app listens here so `codiff sessions` can read and answer session comments in
 * every open window. Lives next to `~/.codiff/codiff.jsonc` so agent sandboxes that rewrite
 * `TMPDIR` still find it.
 */
const getSessionsSocketPath = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\codiff-sessions-${userInfo().username}`
    : join(homedir(), '.codiff', 'sessions.sock');

/** @param {unknown} value @returns {CodiffSessionsRequest | null} */
const parseSessionsRequest = (value) => {
  const request = /** @type {Record<string, unknown> | null} */ (
    value && typeof value === 'object' ? value : null
  );
  if (request?.type === 'list') {
    return { type: 'list' };
  }
  if (
    request?.type === 'reply' &&
    typeof request.sessionId === 'number' &&
    typeof request.commentId === 'string' &&
    typeof request.body === 'string' &&
    request.body.trim() &&
    (request.agentId == null || typeof request.agentId === 'string')
  ) {
    return {
      ...(typeof request.agentId === 'string' ? { agentId: request.agentId } : {}),
      body: request.body,
      commentId: request.commentId,
      sessionId: request.sessionId,
      type: 'reply',
    };
  }
  return null;
};

/**
 * @param {{
 *   handleRequest: (request: CodiffSessionsRequest) => Promise<object>;
 *   socketPath?: string;
 * }} options
 */
const startSessionsServer = ({ handleRequest, socketPath = getSessionsSocketPath() }) => {
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
      /** @type {CodiffSessionsRequest | null} */
      let request = null;
      try {
        request = parseSessionsRequest(JSON.parse(buffer.slice(0, newline)));
      } catch {}

      if (!request) {
        socket.end(`${JSON.stringify({ error: 'Unsupported request.' })}\n`);
        return;
      }

      handleRequest(request).then(
        (response) => socket.end(`${JSON.stringify(response)}\n`),
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
 * Resolves `null` when no Codiff app is listening and rejects when the app reports an error.
 * @param {CodiffSessionsRequest} request
 * @param {{socketPath?: string; timeoutMs?: number}} [options]
 * @returns {Promise<Record<string, unknown> | null>}
 */
const sendSessionsRequest = (
  request,
  { socketPath = getSessionsSocketPath(), timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) =>
  new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error('Codiff did not respond in time.'));
    });
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
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
        resolve(response && typeof response === 'object' ? response : {});
      } catch {
        reject(new Error('Codiff returned an invalid response.'));
      }
    });
  });

/**
 * @param {{socketPath?: string; timeoutMs?: number}} [options]
 * @returns {Promise<CodiffSessionsResponse | null>}
 */
const requestSessions = async (options) => {
  const response = await sendSessionsRequest({ type: 'list' }, options);
  return response ? { sessions: Array.isArray(response.sessions) ? response.sessions : [] } : null;
};

/**
 * Resolves `false` when no Codiff app is listening.
 * @param {Omit<CodiffSessionsReplyRequest, 'type'>} reply
 * @param {{socketPath?: string; timeoutMs?: number}} [options]
 */
const replyToSessionComment = async (reply, options) =>
  (await sendSessionsRequest({ ...reply, type: 'reply' }, options)) != null;

module.exports = {
  getSessionsSocketPath,
  replyToSessionComment,
  requestSessions,
  startSessionsServer,
};
