// @ts-check

/** @param {import('electron').BrowserWindow} window @param {boolean} [useOpacity] */
const createWindowRevealController = (window, useOpacity = false) => {
  let painted = false;
  let contentReady = false;
  let pending = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fallback;

  const reveal = () => {
    if (!pending || window.isDestroyed()) {
      return;
    }
    pending = false;
    clearTimeout(fallback);
    if (useOpacity) {
      window.setOpacity(1);
    } else {
      window.show();
    }
  };
  window.once('ready-to-show', () => {
    painted = true;
    // Native window setup can take a full frame or more on macOS. Overlap it
    // with rendering while the window is transparent, then reveal atomically.
    if (useOpacity && pending && !window.isDestroyed()) {
      window.show();
    }
    if (contentReady) {
      reveal();
    } else {
      // Slow repositories and walkthrough generation should still expose the
      // app's loading state, even if content readiness never arrives.
      fallback = setTimeout(reveal, 1000);
    }
  });
  window.once('closed', () => {
    pending = false;
    clearTimeout(fallback);
  });

  return {
    isPending: () => pending,
    markContentReady: () => {
      contentReady = true;
      if (painted) {
        reveal();
      }
    },
  };
};

module.exports = { createWindowRevealController };
