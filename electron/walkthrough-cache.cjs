// @ts-check

const { createHash } = require('node:crypto');
const {
  getSectionWalkthroughHunks,
  isGeneratedWalkthroughFile,
} = require('../core/lib/narrative-walkthrough-diff.cjs');
const {
  buildNarrativeWalkthroughPrompt,
  normalizeNarrativeWalkthrough,
} = require('./narrative-walkthrough.cjs');
const { narrativeWalkthroughResponseSchema } = require('./narrative-walkthrough-schema.cjs');
const {
  pruneStoredWalkthroughs,
  readStoredWalkthrough,
  writeStoredWalkthrough,
} = require('./walkthrough-store.cjs');

/**
 * @typedef {import('../core/types.ts').NarrativeWalkthrough} NarrativeWalkthrough
 * @typedef {import('../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('../core/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../core/types.ts').WalkthroughContext} WalkthroughContext
 * @typedef {{id: string; normalizeModel: (model: unknown) => string}} CacheAgent
 */

const WALKTHROUGH_CACHE_KEY_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** @param {ReadonlyArray<ChangedFile>} files */
const sortFilesByPath = (files) =>
  [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

/**
 * Hash of the diff itself: file names, statuses, and each section's patch or
 * content fingerprint. It leaves out everything that only says where the diff
 * came from (source, branch, root, section ids), so the same change reviewed
 * as staged edits, a commit, a branch, or a pull request shares one hash.
 *
 * @param {ReadonlyArray<ChangedFile>} files
 */
const getWalkthroughDiffHash = (files) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        sortFilesByPath(files).map((file) => ({
          generated: isGeneratedWalkthroughFile(file),
          oldPath: file.oldPath ?? null,
          path: file.path,
          sections: file.sections.map((section) => ({
            binary: Boolean(section.binary),
            // Deferred and binary sections have no patch; the fingerprint is a
            // hash of their contents.
            contents: section.summary?.fingerprint ?? null,
            loadState: section.loadState ?? 'ready',
            patch: section.patch ?? '',
          })),
          status: file.status,
        })),
      ),
    )
    .digest('hex');

/**
 * Maps each live hunk id to a scope-neutral alias (`<path>#<n>`, counting the
 * file's hunks across its sections). Equal diff hashes imply equal aliases.
 *
 * @param {ReadonlyArray<ChangedFile>} files
 * @returns {Map<string, string>}
 */
const getWalkthroughHunkAliases = (files) => {
  /** @type {Map<string, string>} */
  const aliasByHunkId = new Map();
  for (const file of files) {
    let ordinal = 0;
    for (const section of file.sections) {
      for (const hunk of getSectionWalkthroughHunks(file, section)) {
        ordinal += 1;
        aliasByHunkId.set(hunk.id, `${file.path}#${ordinal}`);
      }
    }
  }
  return aliasByHunkId;
};

// A fixed digest keeps the prompt template in the cache key, so prompt
// changes invalidate cached walkthroughs without the key depending on the
// reviewed diff's source.
const CANONICAL_PROMPT_STATE = {
  branch: null,
  files: [
    {
      path: 'file.ts',
      sections: [{ id: 'file.ts:cache', kind: 'commit', patch: '@@ -1 +1 @@\n-a\n+b\n' }],
      status: 'modified',
    },
  ],
  generatedAt: 0,
  root: '',
  source: { type: 'working-tree' },
};

const PROMPT_TEMPLATE_HASH = createHash('sha256')
  .update(buildNarrativeWalkthroughPrompt(CANONICAL_PROMPT_STATE))
  .digest('hex');

/**
 * Cache identity for a generated walkthrough: the diff hash plus the inputs
 * that change what the agent is asked to write. The review source, PR
 * metadata, and conversation context are not part of it; regenerating
 * replaces the entry when a walkthrough should reflect them.
 *
 * @param {RepositoryState} state
 * @param {CacheAgent} agent
 * @param {unknown} model
 * @param {unknown} [customPrompt]
 */
const getNarrativeWalkthroughCacheKey = (state, agent, model, customPrompt) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        agent: agent.id,
        customPrompt: typeof customPrompt === 'string' ? customPrompt.trim() : '',
        diff: getWalkthroughDiffHash(state.files),
        model: agent.normalizeModel(model),
        prompt: PROMPT_TEMPLATE_HASH,
        responseSchema: narrativeWalkthroughResponseSchema,
        version: WALKTHROUGH_CACHE_KEY_VERSION,
      }),
    )
    .digest('hex');

/**
 * @param {any} group
 * @param {ReadonlyMap<string, string>} aliasByHunkId
 */
const toStoredHunkGroup = (group, aliasByHunkId) => {
  const hunkIds = (group.hunkIds ?? []).map((/** @type {string} */ id) => aliasByHunkId.get(id));
  if (hunkIds.some((/** @type {string | undefined} */ id) => id == null)) {
    return null;
  }
  // Line counts and resolved hunks are recomputed from the live diff on load.
  const { added: _added, deleted: _deleted, hunks: _hunks, ...rest } = group;
  return {
    ...rest,
    hunkIds,
    ...(Array.isArray(group.notes)
      ? {
          notes: group.notes.map((/** @type {{body: string; hunkId: string}} */ note) => ({
            body: note.body,
            hunkId: aliasByHunkId.get(note.hunkId) ?? note.hunkId,
          })),
        }
      : {}),
  };
};

/**
 * Converts a normalized walkthrough into its scope-neutral stored shape, or
 * `null` when a hunk does not belong to the diff.
 *
 * @param {NarrativeWalkthrough} walkthrough
 * @param {ReadonlyArray<ChangedFile>} files
 */
const toStoredWalkthrough = (walkthrough, files) => {
  const aliasByHunkId = getWalkthroughHunkAliases(files);
  const chapters = [];
  for (const chapter of walkthrough.chapters) {
    const stops = chapter.stops.map((stop) => toStoredHunkGroup(stop, aliasByHunkId));
    if (stops.some((stop) => stop == null)) {
      return null;
    }
    chapters.push({ ...chapter, stops });
  }
  const support = walkthrough.support.map((group) => toStoredHunkGroup(group, aliasByHunkId));
  if (support.some((group) => group == null)) {
    return null;
  }

  return {
    chapters,
    ...(walkthrough.commit ? { commit: walkthrough.commit } : {}),
    focus: walkthrough.focus,
    generatedAt: walkthrough.generatedAt,
    support,
    title: walkthrough.title,
  };
};

/**
 * @param {number | undefined} maxAgeDays
 */
const getMaxAgeMs = (maxAgeDays) =>
  typeof maxAgeDays === 'number' && Number.isFinite(maxAgeDays) && maxAgeDays >= 0
    ? maxAgeDays * DAY_MS
    : 7 * DAY_MS;

/**
 * Entries not used for `getMaxAgeDays()` days are deleted, checked at most
 * hourly. A max age of 0 disables the cache.
 *
 * @param {{getMaxAgeDays?: () => number | undefined; now?: () => number}} [options]
 */
const createWalkthroughCache = ({ getMaxAgeDays = () => undefined, now = Date.now } = {}) => {
  let lastPrunedAt = Number.NEGATIVE_INFINITY;

  /** @param {number} maxAgeMs */
  const prune = (maxAgeMs) => {
    const current = now();
    if (current - lastPrunedAt < PRUNE_INTERVAL_MS) {
      return;
    }
    lastPrunedAt = current;
    pruneStoredWalkthroughs(maxAgeMs, current);
  };

  return {
    /**
     * Reads the cached walkthrough for this diff and anchors it to the current
     * hunk ids and source, or returns `null` on a miss.
     *
     * @param {RepositoryState} state
     * @param {CacheAgent} agent
     * @param {unknown} model
     * @param {{context?: WalkthroughContext | null; customPrompt?: unknown}} [options]
     * @returns {NarrativeWalkthrough | null}
     */
    read(state, agent, model, { context, customPrompt } = {}) {
      const maxAgeMs = getMaxAgeMs(getMaxAgeDays());
      prune(maxAgeMs);
      if (maxAgeMs === 0) {
        return null;
      }
      const stored = readStoredWalkthrough(
        getNarrativeWalkthroughCacheKey(state, agent, model, customPrompt),
      );
      if (!stored) {
        return null;
      }

      /** @type {Map<string, string>} */
      const hunkIdByAlias = new Map();
      for (const [hunkId, alias] of getWalkthroughHunkAliases(state.files)) {
        hunkIdByAlias.set(alias, hunkId);
      }
      try {
        return normalizeNarrativeWalkthrough(
          stored,
          state.files,
          {
            agent: agent.id,
            branch: state.branch,
            ...(context ? { context } : {}),
            generatedAt: stored.generatedAt,
            root: state.root,
            source: state.source,
          },
          hunkIdByAlias,
        );
      } catch {
        return null;
      }
    },

    /**
     * Stores a generated walkthrough under this diff's hash, replacing any
     * earlier entry. Caching is best effort and never throws.
     *
     * @param {RepositoryState} state
     * @param {CacheAgent} agent
     * @param {unknown} model
     * @param {NarrativeWalkthrough} walkthrough
     * @param {{customPrompt?: unknown}} [options]
     */
    write(state, agent, model, walkthrough, { customPrompt } = {}) {
      const maxAgeMs = getMaxAgeMs(getMaxAgeDays());
      if (maxAgeMs === 0) {
        return;
      }
      try {
        const stored = toStoredWalkthrough(walkthrough, state.files);
        if (stored) {
          writeStoredWalkthrough(
            getNarrativeWalkthroughCacheKey(state, agent, model, customPrompt),
            stored,
          );
        }
      } catch {
        // Caching is optional; a filesystem failure must not hide a generated result.
      }
      prune(maxAgeMs);
    },
  };
};

module.exports = {
  createWalkthroughCache,
  getNarrativeWalkthroughCacheKey,
  getWalkthroughDiffHash,
  getWalkthroughHunkAliases,
  toStoredWalkthrough,
};
