import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';
import { createDefaultConfig } from '../../core/config/defaults.ts';

const require = createRequire(import.meta.url);
const { resolveTaskAgent } = require('../task-agents.cjs') as {
  resolveTaskAgent: (
    settings: unknown,
    task: 'ask' | 'review' | 'walkthrough',
    defaultAgentId: string,
  ) => { agent: { id: string }; model: string; overridesModel: boolean };
};

const settings = {
  ...createDefaultConfig().settings,
  claudeModel: 'claude-haiku-4-5',
  openAIModel: 'gpt-5.6-terra',
  taskAgents: {
    ask: { agent: '', model: '' },
    review: { agent: 'claude', model: 'claude-opus-4-8' },
    walkthrough: { agent: 'codex', model: '' },
  },
};

test('a task without a choice uses the default agent and its model setting', () => {
  const { agent, model, overridesModel } = resolveTaskAgent(settings, 'ask', 'claude');
  expect([agent.id, model, overridesModel]).toEqual(['claude', 'claude-haiku-4-5', false]);
});

test('a task with an agent and model uses both', () => {
  const { agent, model, overridesModel } = resolveTaskAgent(settings, 'review', 'codex');
  expect(agent.id).toBe('claude');
  expect(model).toBe('claude-opus-4-8');
  expect(overridesModel).toBe(true);
});

test('a task with only an agent uses that agent’s model setting', () => {
  const { agent, model, overridesModel } = resolveTaskAgent(settings, 'walkthrough', 'claude');
  expect([agent.id, model, overridesModel]).toEqual(['codex', 'gpt-5.6-terra', false]);
});
