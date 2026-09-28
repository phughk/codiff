// @ts-check

const { createHash, randomUUID } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const MAX_STORED_WALKTHROUGH_BYTES = 8 * 1024 * 1024;
const STORED_WALKTHROUGH_VERSION = 2;

const getWalkthroughStoreDir = () => join(homedir(), '.codiff', 'walkthroughs');

/** @param {string} cacheKey */
const getWalkthroughStorePath = (cacheKey) =>
  join(getWalkthroughStoreDir(), `${createHash('sha256').update(cacheKey).digest('hex')}.json`);

/**
 * Stored walkthroughs are kept in their scope-neutral authoring shape and are
 * re-anchored against the live diff on load, so only the outline is checked.
 *
 * @param {unknown} value
 */
const isStoredWalkthrough = (value) => {
  const walkthrough = /** @type {any} */ (value);
  return (
    walkthrough &&
    typeof walkthrough === 'object' &&
    typeof walkthrough.title === 'string' &&
    Array.isArray(walkthrough.chapters) &&
    walkthrough.chapters.length > 0
  );
};

/**
 * Reads a stored walkthrough and marks it as recently used, so pruning only
 * removes entries that have not been read or written for a while.
 *
 * @param {string} cacheKey
 * @returns {Record<string, any> | null}
 */
const readStoredWalkthrough = (cacheKey) => {
  const path = getWalkthroughStorePath(cacheKey);
  if (!existsSync(path)) {
    return null;
  }

  try {
    if (statSync(path).size > MAX_STORED_WALKTHROUGH_BYTES) {
      return null;
    }
    const text = readFileSync(path, 'utf8');
    const record = JSON.parse(text);
    if (
      !record ||
      typeof record !== 'object' ||
      record.version !== STORED_WALKTHROUGH_VERSION ||
      record.cacheKey !== cacheKey ||
      !isStoredWalkthrough(record.walkthrough)
    ) {
      return null;
    }
    try {
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      // A read-only store still serves the entry; it just ages from its last write.
    }
    return record.walkthrough;
  } catch {
    return null;
  }
};

/**
 * @param {string} cacheKey
 * @param {Record<string, unknown>} walkthrough
 */
const writeStoredWalkthrough = (cacheKey, walkthrough) => {
  const directory = getWalkthroughStoreDir();
  mkdirSync(directory, { recursive: true });
  const path = getWalkthroughStorePath(cacheKey);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      JSON.stringify({
        cacheKey,
        version: STORED_WALKTHROUGH_VERSION,
        walkthrough,
      }),
    );
    try {
      renameSync(temporaryPath, path);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (!existsSync(path) || (code !== 'EEXIST' && code !== 'EPERM')) {
        throw error;
      }
      rmSync(path, { force: true });
      renameSync(temporaryPath, path);
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

/**
 * Deletes stored walkthroughs (and interrupted temporary writes) that were
 * last used more than `maxAgeMs` ago. Returns the number of removed files.
 *
 * @param {number} maxAgeMs
 * @param {number} [now]
 */
const pruneStoredWalkthroughs = (maxAgeMs, now = Date.now()) => {
  let entries;
  try {
    entries = readdirSync(getWalkthroughStoreDir());
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json') && !entry.endsWith('.tmp')) {
      continue;
    }
    const path = join(getWalkthroughStoreDir(), entry);
    try {
      if (now - statSync(path).mtimeMs > maxAgeMs) {
        rmSync(path, { force: true });
        removed += 1;
      }
    } catch {
      // Another process may have removed or replaced the entry concurrently.
    }
  }
  return removed;
};

module.exports = {
  getWalkthroughStoreDir,
  getWalkthroughStorePath,
  pruneStoredWalkthroughs,
  readStoredWalkthrough,
  writeStoredWalkthrough,
};
