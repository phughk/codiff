// @ts-check

const DEFAULT_COPY_PENDING_COMMENTS_TIMEOUT_MS = 2000;

/**
 * @typedef {{
 *   id: number;
 *   isDestroyed: () => boolean;
 *   send: (channel: string, requestId: number) => void;
 * }} PendingCommentsWebContents
 */
/**
 * @typedef {{
 *   isDestroyed: () => boolean;
 *   webContents: PendingCommentsWebContents;
 * }} PendingCommentsBrowserWindow
 */
/**
 * @typedef {{
 *   sender: {
 *     id: number;
 *   };
 * }} PendingCommentsIpcEvent
 */
/**
 * @typedef {{
 *   resolve: (result: unknown) => void;
 *   webContentsId: number;
 * }} PendingCommentsRequest
 */

/**
 * @param {{
 *   clipboard: {
 *     writeText: (text: string) => void;
 *   };
 *   timeoutMs?: number;
 * }} options
 */
const createPendingCommentsClipboardController = ({
  clipboard,
  timeoutMs = DEFAULT_COPY_PENDING_COMMENTS_TIMEOUT_MS,
}) => {
  let nextRequestId = 0;
  /** @type {Map<number, PendingCommentsRequest>} */
  const pendingRequests = new Map();

  /**
   * @param {PendingCommentsIpcEvent} event
   * @param {number} requestId
   * @param {unknown} result
   */
  const handleResult = (event, requestId, result) => {
    const pending = pendingRequests.get(requestId);
    if (!pending || pending.webContentsId !== event.sender.id) {
      return;
    }

    pendingRequests.delete(requestId);
    pending.resolve(result);
  };

  /**
   * @param {PendingCommentsBrowserWindow} browserWindow
   * @param {string} channel
   * @returns {Promise<unknown>}
   */
  const request = (browserWindow, channel) =>
    new Promise((resolve) => {
      if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        resolve(null);
        return;
      }

      const requestId = ++nextRequestId;
      const webContentsId = browserWindow.webContents.id;
      const timeout = setTimeout(() => {
        if (pendingRequests.delete(requestId)) {
          resolve(null);
        }
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        webContentsId,
      });

      browserWindow.webContents.send(channel, requestId);
    });

  /**
   * @param {PendingCommentsIpcEvent} event
   * @param {number} requestId
   * @param {unknown} markdown
   */
  const handleCopyPendingCommentsResult = (event, requestId, markdown) =>
    handleResult(event, requestId, typeof markdown === 'string' ? markdown : '');

  /** @param {PendingCommentsBrowserWindow} browserWindow @returns {Promise<string>} */
  const requestPendingCommentsMarkdown = async (browserWindow) => {
    const markdown = await request(browserWindow, 'codiff:copyPendingCommentsRequest');
    return typeof markdown === 'string' ? markdown : '';
  };

  /**
   * Structured draft comments for `codiff-sessions`. Resolves `null` when the window
   * does not answer in time.
   * @param {PendingCommentsBrowserWindow} browserWindow
   */
  const requestPendingComments = (browserWindow) =>
    request(browserWindow, 'codiff:pendingCommentsRequest');

  /** @param {ReadonlyArray<PendingCommentsBrowserWindow>} browserWindows */
  const copyPendingCommentsToClipboard = async (browserWindows) => {
    const markdownBlocks = (
      await Promise.all(browserWindows.map((window) => requestPendingCommentsMarkdown(window)))
    ).filter(Boolean);

    if (markdownBlocks.length) {
      clipboard.writeText(markdownBlocks.join('\n\n'));
    }
  };

  return {
    copyPendingCommentsToClipboard,
    handleCopyPendingCommentsResult,
    handlePendingCommentsResult: handleResult,
    requestPendingComments,
    requestPendingCommentsMarkdown,
  };
};

module.exports = { createPendingCommentsClipboardController };
