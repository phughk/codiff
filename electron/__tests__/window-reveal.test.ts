import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { createWindowRevealController } = require('../window-reveal.cjs') as {
  createWindowRevealController: (
    window: BrowserWindow,
    useOpacity?: boolean,
  ) => {
    isPending: () => boolean;
    markContentReady: () => void;
  };
};

const createWindow = (useOpacity = false) => {
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setOpacity: vi.fn(),
    show: vi.fn(),
  });
  return {
    controller: createWindowRevealController(window as unknown as BrowserWindow, useOpacity),
    window,
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('a shell paint does not reveal the window before its content', () => {
  const { controller, window } = createWindow();
  window.emit('ready-to-show');
  vi.advanceTimersByTime(100);
  expect(window.show).not.toHaveBeenCalled();
  controller.markContentReady();
  expect(window.show).toHaveBeenCalledOnce();
  expect(controller.isPending()).toBe(false);
  vi.runAllTimers();
  controller.markContentReady();
  expect(window.show).toHaveBeenCalledOnce();
});

test('content readiness also waits for the native first paint', () => {
  const { controller, window } = createWindow();
  controller.markContentReady();
  expect(window.show).not.toHaveBeenCalled();
  window.emit('ready-to-show');
  expect(window.show).toHaveBeenCalledOnce();
});

test('slow or failed content exposes the loading view after a bounded wait', () => {
  const { window } = createWindow();
  window.emit('ready-to-show');
  vi.advanceTimersByTime(999);
  expect(window.show).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(window.show).toHaveBeenCalledOnce();
});

test('closing during startup cancels the reveal', () => {
  const { controller, window } = createWindow();
  window.emit('ready-to-show');
  window.emit('closed');
  controller.markContentReady();
  vi.runAllTimers();
  expect(window.show).not.toHaveBeenCalled();
});

test('native setup can run transparently before the atomic content reveal', () => {
  const { controller, window } = createWindow(true);
  window.emit('ready-to-show');
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.setOpacity).not.toHaveBeenCalled();
  expect(controller.isPending()).toBe(true);
  controller.markContentReady();
  expect(window.setOpacity).toHaveBeenCalledExactlyOnceWith(1);
  expect(window.show).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(window.setOpacity).toHaveBeenCalledOnce();
});
