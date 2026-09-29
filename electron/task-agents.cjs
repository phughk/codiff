// @ts-check

const { getAgent } = require('./agent.cjs');

/**
 * @typedef {import('../core/config/types.ts').CodiffAgentBackend} CodiffAgentBackend
 * @typedef {import('../core/config/types.ts').CodiffAgentTask} CodiffAgentTask
 * @typedef {import('../core/config/types.ts').CodiffSettings} CodiffSettings
 * @typedef {import('./agent.cjs').Agent} Agent
 */

/** @type {Record<CodiffAgentTask, string>} */
const TASK_LABELS = {
  ask: 'Ask',
  review: 'Review',
  walkthrough: 'Walkthrough',
};

/**
 * The agent and model a task runs with. A task's own choice wins; otherwise
 * it uses `defaultAgentId` (the window's agent) and that agent's model setting.
 *
 * @param {CodiffSettings} settings
 * @param {CodiffAgentTask} task
 * @param {CodiffAgentBackend} defaultAgentId
 * @returns {{agent: Agent; model: string; overridesModel: boolean}}
 */
const resolveTaskAgent = (settings, task, defaultAgentId) => {
  const choice = settings.taskAgents?.[task];
  const agent = getAgent(choice?.agent || defaultAgentId);
  const overridesModel = Boolean(choice?.agent && choice.model);
  return {
    agent,
    model: overridesModel ? agent.normalizeModel(choice?.model) : settings[agent.modelSettingKey],
    overridesModel,
  };
};

module.exports = { TASK_LABELS, resolveTaskAgent };
