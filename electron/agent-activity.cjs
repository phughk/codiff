// @ts-check

const { isAbsolute, relative } = require('node:path');

/**
 * Turns agent tool calls into short, reviewer-facing steps such as
 * "Read src/state.ts" or "Searched for `syncState`".
 *
 * @typedef {import('../core/types.ts').AgentActivity} AgentActivity
 */

const MAX_DETAIL_CHARS = 160;

/** Read-only git subcommands an investigating agent may run. */
const READ_ONLY_GIT_COMMANDS = Object.freeze(['blame', 'diff', 'grep', 'log', 'ls-files', 'show']);

/** Claude Code tools available while investigating, all read-only. */
const CLAUDE_INVESTIGATION_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Bash']);

/** Claude Code permission rules: file tools plus read-only git and search commands. */
const CLAUDE_INVESTIGATION_ALLOWED_TOOLS = Object.freeze([
  'Read',
  'Grep',
  'Glob',
  ...READ_ONLY_GIT_COMMANDS.map((command) => `Bash(git ${command}:*)`),
  'Bash(ls:*)',
  'Bash(rg:*)',
  'Bash(wc:*)',
]);

/** @param {string} value @param {number} [max] */
const clip = (value, max = MAX_DETAIL_CHARS) => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
};

/** @param {unknown} path @param {string | undefined} root */
const toDisplayPath = (path, root) => {
  if (typeof path !== 'string' || !path) {
    return '';
  }
  if (root && isAbsolute(path)) {
    const relativePath = relative(root, path);
    if (!relativePath) {
      // The workspace itself; "in ." would only add noise.
      return '';
    }
    if (!relativePath.startsWith('..') && !isAbsolute(relativePath)) {
      return relativePath;
    }
  }
  return path;
};

/** @param {string} command @param {string | undefined} root @returns {AgentActivity} */
const describeCommand = (command, root) => {
  let text = command.trim();
  // Codex wraps commands as `bash -lc '…'`.
  const wrapped = /^(?:\/\S+\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(text);
  if (wrapped) {
    text = wrapped[2];
  }
  if (root) {
    text = text.split(`${root}/`).join('');
  }
  const [program = '', subcommand = ''] = text.split(/\s+/);
  if (/^(?:rg|grep|ag)$/.test(program) || (program === 'git' && subcommand === 'grep')) {
    return { detail: clip(text), kind: 'search', label: 'Searched the code' };
  }
  if (/^(?:cat|sed|head|tail|nl|less)$/.test(program)) {
    return { detail: clip(text), kind: 'read', label: 'Read a file' };
  }
  if (/^(?:ls|find|fd|tree)$/.test(program) || (program === 'git' && subcommand === 'ls-files')) {
    return { detail: clip(text), kind: 'list', label: 'Listed files' };
  }
  if (program === 'git' && /^(?:log|show|blame|diff)$/.test(subcommand)) {
    return { detail: clip(text), kind: 'history', label: `Checked git ${subcommand}` };
  }
  return { detail: clip(text), kind: 'command', label: 'Ran a command' };
};

/**
 * @param {string} name
 * @param {any} input
 * @param {string | undefined} root
 * @returns {AgentActivity}
 */
const describeToolUse = (name, input, root) => {
  const tool = name.toLowerCase();
  if (tool === 'read' || tool === 'view') {
    const path = toDisplayPath(input?.file_path ?? input?.filePath ?? input?.path, root);
    const offset = Number(input?.offset);
    return {
      ...(Number.isFinite(offset) && offset > 0 ? { detail: `from line ${offset}` } : {}),
      kind: 'read',
      label: path ? `Read ${path}` : 'Read a file',
    };
  }
  if (tool === 'grep') {
    const pattern = typeof input?.pattern === 'string' ? input.pattern : '';
    const path = toDisplayPath(input?.path ?? input?.include ?? input?.glob, root);
    return {
      ...(path ? { detail: `in ${path}` } : {}),
      kind: 'search',
      label: pattern ? `Searched for \`${clip(pattern, 80)}\`` : 'Searched the code',
    };
  }
  if (tool === 'glob' || tool === 'find' || tool === 'list' || tool === 'ls') {
    const pattern = typeof input?.pattern === 'string' ? input.pattern : '';
    const path = toDisplayPath(input?.path, root);
    return {
      ...(path && pattern ? { detail: `in ${path}` } : {}),
      kind: 'list',
      label: pattern
        ? `Found files matching \`${clip(pattern, 80)}\``
        : path
          ? `Listed ${path}`
          : 'Listed files',
    };
  }
  if (tool === 'bash' && typeof input?.command === 'string') {
    return describeCommand(input.command, root);
  }
  return { kind: 'other', label: `Used ${name}` };
};

module.exports = {
  CLAUDE_INVESTIGATION_ALLOWED_TOOLS,
  CLAUDE_INVESTIGATION_TOOLS,
  describeCommand,
  describeToolUse,
};
