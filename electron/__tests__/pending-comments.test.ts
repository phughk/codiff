import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

type FakeBrowserWindow = {
  isDestroyed: () => boolean;
  webContents: {
    id: number;
    isDestroyed: () => boolean;
    send: (channel: string, requestId: number) => void;
  };
};

type SentMessage = {
  channel: string;
  requestId: number;
};

const require = createRequire(import.meta.url);
const { createPendingCommentsClipboardController } = require('../pending-comments.cjs') as {
  createPendingCommentsClipboardController: (options: {
    clipboard: {
      writeText: (text: string) => void;
    };
    timeoutMs?: number;
  }) => {
    copyPendingCommentsToClipboard: (
      browserWindows: ReadonlyArray<FakeBrowserWindow>,
    ) => Promise<void>;
    handleCopyPendingCommentsResult: (
      event: { sender: { id: number } },
      requestId: number,
      markdown: unknown,
    ) => void;
    handlePendingCommentsResult: (
      event: { sender: { id: number } },
      requestId: number,
      comments: unknown,
    ) => void;
    requestPendingComments: (browserWindow: FakeBrowserWindow) => Promise<unknown>;
    requestPendingCommentsMarkdown: (browserWindow: FakeBrowserWindow) => Promise<string>;
  };
};

const createFakeWindow = (id: number) => {
  const sentMessages: Array<SentMessage> = [];
  const browserWindow: FakeBrowserWindow = {
    isDestroyed: () => false,
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel, requestId) => {
        sentMessages.push({ channel, requestId });
      },
    },
  };

  return { browserWindow, sentMessages };
};

test('copies one window of pending comments before close', async () => {
  const clipboardWrites: Array<string> = [];
  const controller = createPendingCommentsClipboardController({
    clipboard: {
      writeText: (text) => clipboardWrites.push(text),
    },
  });
  const window = createFakeWindow(1);

  const copyPromise = controller.copyPendingCommentsToClipboard([window.browserWindow]);

  expect(window.sentMessages).toEqual([
    {
      channel: 'codiff:copyPendingCommentsRequest',
      requestId: 1,
    },
  ]);

  controller.handleCopyPendingCommentsResult(
    { sender: { id: 1 } },
    1,
    '# Address these Review Comments\n\nOne window.',
  );
  await copyPromise;

  expect(clipboardWrites).toEqual(['# Address these Review Comments\n\nOne window.']);
});

test('copies all windows together before app quit instead of overwriting clipboard', async () => {
  const clipboardWrites: Array<string> = [];
  const controller = createPendingCommentsClipboardController({
    clipboard: {
      writeText: (text) => clipboardWrites.push(text),
    },
  });
  const firstWindow = createFakeWindow(1);
  const secondWindow = createFakeWindow(2);

  const copyPromise = controller.copyPendingCommentsToClipboard([
    firstWindow.browserWindow,
    secondWindow.browserWindow,
  ]);

  expect(firstWindow.sentMessages).toEqual([
    {
      channel: 'codiff:copyPendingCommentsRequest',
      requestId: 1,
    },
  ]);
  expect(secondWindow.sentMessages).toEqual([
    {
      channel: 'codiff:copyPendingCommentsRequest',
      requestId: 2,
    },
  ]);

  controller.handleCopyPendingCommentsResult({ sender: { id: 2 } }, 2, 'Second window comments.');
  controller.handleCopyPendingCommentsResult({ sender: { id: 1 } }, 1, 'First window comments.');
  await copyPromise;

  expect(clipboardWrites).toEqual(['First window comments.\n\nSecond window comments.']);
});

test('ignores pending comment responses from the wrong window', async () => {
  const controller = createPendingCommentsClipboardController({
    clipboard: {
      writeText: () => {},
    },
  });
  const window = createFakeWindow(1);

  const markdownPromise = controller.requestPendingCommentsMarkdown(window.browserWindow);

  controller.handleCopyPendingCommentsResult({ sender: { id: 2 } }, 1, 'Wrong window.');
  controller.handleCopyPendingCommentsResult({ sender: { id: 1 } }, 1, 'Right window.');

  await expect(markdownPromise).resolves.toBe('Right window.');
});

test('requests structured pending comments for codiff-sessions', async () => {
  const controller = createPendingCommentsClipboardController({
    clipboard: { writeText: () => {} },
  });
  const window = createFakeWindow(4);
  const comments = [{ body: 'Rename this.', id: 'a' }];

  const request = controller.requestPendingComments(window.browserWindow);

  expect(window.sentMessages).toEqual([{ channel: 'codiff:pendingCommentsRequest', requestId: 1 }]);
  controller.handlePendingCommentsResult({ sender: { id: 5 } }, 1, []);
  controller.handlePendingCommentsResult({ sender: { id: 4 } }, 1, comments);

  await expect(request).resolves.toBe(comments);
});

test('resolves null when a window does not return pending comments', async () => {
  const controller = createPendingCommentsClipboardController({
    clipboard: { writeText: () => {} },
    timeoutMs: 1,
  });

  await expect(controller.requestPendingComments(createFakeWindow(1).browserWindow)).resolves.toBe(
    null,
  );
});
