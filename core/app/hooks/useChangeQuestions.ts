import { useCallback, useState, type RefObject } from 'react';
import { getSourceKey } from '../../lib/source.ts';
import type { AgentActivity, RepositoryState, ReviewAssistantRequest } from '../../types.ts';

export type ChangeQuestionTurn = {
  activity: ReadonlyArray<AgentActivity>;
  error?: string;
  id: string;
  question: string;
  reply?: string;
  status: 'error' | 'loading' | 'ready';
};

const emptyTurns: ReadonlyArray<ChangeQuestionTurn> = [];

/**
 * A conversation with the agent about the whole change, independent of any
 * inline note. The agent investigates the checked-out head before answering,
 * and its steps stream into the turn while it works. Turns are kept per
 * source so switching to another diff starts a fresh conversation.
 */
export function useChangeQuestions(stateRef: RefObject<RepositoryState | null>) {
  const [conversation, setConversation] = useState<{
    sourceKey: string;
    turns: ReadonlyArray<ChangeQuestionTurn>;
  } | null>(null);

  const updateTurn = useCallback(
    (sourceKey: string, id: string, update: Partial<ChangeQuestionTurn>) =>
      setConversation((current) =>
        current?.sourceKey === sourceKey
          ? {
              sourceKey,
              turns: current.turns.map((turn) => (turn.id === id ? { ...turn, ...update } : turn)),
            }
          : current,
      ),
    [],
  );

  const ask = useCallback(
    (rawQuestion: string) => {
      const state = stateRef.current;
      const question = rawQuestion.trim();
      if (!state || !question) {
        return;
      }
      const sourceKey = getSourceKey(state.source);
      const current = conversation;
      const previousTurns = current?.sourceKey === sourceKey ? current.turns : emptyTurns;
      if (previousTurns.some((turn) => turn.status === 'loading')) {
        return;
      }

      const answered = previousTurns.filter((turn) => turn.status === 'ready' && turn.reply);
      const [first, ...rest] = answered;
      const id = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      // The first answered question anchors the conversation; later turns are
      // sent as follow-ups so the agent builds on what it already said.
      const request: ReviewAssistantRequest = first
        ? {
            conversation: [
              { body: first.reply ?? '', role: 'agent' },
              ...rest.flatMap((turn) => [
                { body: turn.question, role: 'reviewer' as const },
                { body: turn.reply ?? '', role: 'agent' as const },
              ]),
            ],
            followUp: question,
            question: first.question,
            requestId: `question:${id}`,
            source: state.source,
          }
        : { question, requestId: `question:${id}`, source: state.source };

      const turn: ChangeQuestionTurn = { activity: [], id, question, status: 'loading' };
      setConversation({ sourceKey, turns: [...previousTurns, turn] });

      const activity: Array<AgentActivity> = [];
      const unsubscribe = window.codiff.onReviewAssistantActivity?.((event) => {
        if (event.requestId !== request.requestId) {
          return;
        }
        activity.push(event.activity);
        updateTurn(sourceKey, id, { activity: [...activity] });
      });
      const settle = (update: Partial<ChangeQuestionTurn>) => {
        unsubscribe?.();
        updateTurn(sourceKey, id, update);
      };

      void window.codiff
        .askReviewAssistant(request)
        .then((result) =>
          settle(
            result.status === 'ready'
              ? { activity: result.activity ?? activity, reply: result.reply, status: 'ready' }
              : { activity, error: result.reason, status: 'error' },
          ),
        )
        .catch((error: unknown) =>
          settle({
            activity,
            error: error instanceof Error ? error.message : String(error),
            status: 'error',
          }),
        );
    },
    [conversation, stateRef, updateTurn],
  );

  const clear = useCallback(
    () =>
      setConversation((current) =>
        current?.turns.some((turn) => turn.status === 'loading') ? current : null,
      ),
    [],
  );

  const getTurns = useCallback(
    (sourceKey: string | null) =>
      sourceKey != null && conversation?.sourceKey === sourceKey ? conversation.turns : emptyTurns,
    [conversation],
  );

  return { ask, clear, getTurns };
}
