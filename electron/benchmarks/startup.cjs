// Runs the real Electron app with isolated settings and startup measurements.
const { app, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');

const origin = Number(process.env.CODIFF_BENCHMARK_ORIGIN);
const measurements = {};
let browserWindow;
let capture;
let finishing = false;
const mark = (name, time = performance.timeOrigin + performance.now()) => {
  measurements[name] ??= time - origin;
  if (name === 'windowShown') {
    browserWindow.webContents.send('startup-benchmark-visible');
  }
  if (name === 'windowShown' && process.env.CODIFF_BENCHMARK_CAPTURE) {
    capture = browserWindow.webContents.capturePage().then((image) => {
      writeFileSync(process.env.CODIFF_BENCHMARK_CAPTURE, image.toPNG());
    });
  }
  if (!finishing && measurements.settled != null && measurements.windowShown != null) {
    finishing = true;
    measurements.partialView = Math.max(0, measurements.content - measurements.windowShown);
    measurements.completeView = Math.max(measurements.content, measurements.windowShown);
    writeFileSync(process.env.CODIFF_BENCHMARK_OUTPUT, JSON.stringify(measurements));
    Promise.resolve(capture).finally(() => app.exit());
  }
};
os.homedir = () => process.env.CODIFF_BENCHMARK_HOME;
app.setPath('userData', join(os.homedir(), 'chromium'));

// Session preloads run before the app bundle, including inside a hidden window.
const preload = join(os.homedir(), 'startup-preload.cjs');
writeFileSync(
  preload,
  `const { ipcRenderer } = require('electron');
globalThis.startupBenchmarkVisible = false;
ipcRenderer.on('startup-benchmark-visible', () => { globalThis.startupBenchmarkVisible = true; });
globalThis.startupBenchmark = (payload) => ipcRenderer.send('startup-benchmark', payload);
(${observeStartup.toString()})();`,
);
ipcMain.on('startup-benchmark', (_event, payload) => {
  const { name, partialFrames, time } = JSON.parse(payload);
  measurements.partialFrames = Math.max(measurements.partialFrames ?? 0, partialFrames);
  mark(name, time);
});
app.on('browser-window-created', (_event, window) => {
  browserWindow = window;
  mark('windowCreated');
  window.webContents.session.registerPreloadScript({ filePath: preload, type: 'frame' });
  window.once('ready-to-show', () => mark('electronReady'));
  const show = window.show.bind(window);
  window.show = () => {
    show();
    mark('nativeShown');
    if (window.getOpacity() > 0) mark('windowShown');
  };
  const setOpacity = window.setOpacity.bind(window);
  window.setOpacity = (opacity) => {
    setOpacity(opacity);
    if (opacity > 0) mark('windowShown');
  };
});

function observeStartup() {
  const seen = new Set();
  let partialFrames = 0;
  const report = (name, time = performance.timeOrigin + performance.now()) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    window.startupBenchmark(JSON.stringify({ name, partialFrames, time }));
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      report(entry.name, performance.timeOrigin + entry.startTime);
    }
  }).observe({ buffered: true, type: 'paint' });
  let contentFrame = 0;
  const frame = () => {
    if (document.querySelector('.app-shell')) {
      report('shell');
    }
    const containers = [...document.querySelectorAll('.review diffs-container')].filter((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight;
    });
    const diffReady =
      containers.length > 0 &&
      containers.every((node) =>
        node.classList.contains('codiff-markdown-preview-item')
          ? node.querySelector('.codiff-markdown-preview-editor') &&
            !node.querySelector(
              '.codiff-readonly-markdown-loading, .codiff-markdown-editor-message:not(.error)',
            )
          : node.shadowRoot?.querySelector('[data-code] [data-line]'),
      );
    const emptyReady = document.querySelector('.empty-panel');
    const planEditor = document.querySelector(
      '.plan-shell [contenteditable], .codiff-markdown-editor-unsupported',
    );
    const planReady = planEditor?.textContent.includes('Startup review');
    const ready = (diffReady || emptyReady || planReady) && document.fonts.status === 'loaded';
    if (window.startupBenchmarkVisible && !ready) partialFrames++;
    if (ready) {
      report('content');
      if (++contentFrame === 3) {
        report('settled');
        return;
      }
    } else {
      contentFrame = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

require(join(process.env.CODIFF_BENCHMARK_APP, 'electron/main.cjs'));
