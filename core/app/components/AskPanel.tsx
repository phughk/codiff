import { ArrowUpIcon as ArrowUp } from '@phosphor-icons/react/ArrowUp';
import { ChatsCircleIcon as ChatsCircle } from '@phosphor-icons/react/ChatsCircle';
import { CircleNotchIcon as CircleNotch } from '@phosphor-icons/react/CircleNotch';
import { TrashIcon as Trash } from '@phosphor-icons/react/Trash';
import { XIcon as X } from '@phosphor-icons/react/X';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ChangeQuestionTurn } from '../hooks/useChangeQuestions.ts';
import { AgentActivityDisclosure, AgentActivityStep, formatStepCount } from './AgentActivity.tsx';

const PreviewDocument = lazy(() => import('./MarkdownPreviewDocument.tsx'));

const exampleQuestions = [
  'What is the riskiest part of this change?',
  'Who calls the functions this change modifies?',
  'Does anything outside the diff need updating?',
];

export function AskButton({
  active,
  disabled = false,
  loading,
  onToggle,
}: {
  active: boolean;
  disabled?: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={active}
      aria-haspopup="dialog"
      className={`agent-review-button${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onToggle}
      title="Ask a question about the whole change"
      type="button"
    >
      {loading ? (
        <CircleNotch aria-hidden className="agent-review-spinner" size={14} weight="bold" />
      ) : (
        <ChatsCircle aria-hidden size={14} weight="bold" />
      )}
      <span>Ask</span>
    </button>
  );
}

function AskAnswer({ agentLabel, turn }: { agentLabel: string; turn: ChangeQuestionTurn }) {
  const currentStep = turn.activity.at(-1);
  if (turn.status === 'loading') {
    return (
      <div aria-live="polite" className="ask-panel-progress" role="status">
        {currentStep ? (
          <>
            <span className="agent-activity-current">
              <AgentActivityStep step={currentStep} />
            </span>
            <span className="agent-activity-count">
              Investigating · {formatStepCount(turn.activity.length)}
            </span>
          </>
        ) : (
          <span className="agent-activity-count">Waiting for {agentLabel}…</span>
        )}
      </div>
    );
  }
  return (
    <>
      {turn.status === 'error' ? (
        <p className="ask-panel-error">{turn.error || `${agentLabel} could not answer.`}</p>
      ) : (
        <Suspense fallback={<div className="codiff-readonly-markdown-loading">Loading…</div>}>
          <PreviewDocument
            ariaLabel={`${agentLabel} answer`}
            className="ask-panel-answer-markdown"
            density="compact"
            value={turn.reply ?? ''}
            variant="embedded"
          />
        </Suspense>
      )}
      {turn.activity.length > 0 ? <AgentActivityDisclosure activity={turn.activity} /> : null}
    </>
  );
}

/**
 * Question and answer about the whole change. Answers lead; the agent's
 * investigation shows as a live status while it works and stays available,
 * collapsed, once it answers.
 */
export function AskPanel({
  agentLabel,
  onAsk,
  onClear,
  onClose,
  turns,
  visible,
}: {
  agentLabel: string;
  onAsk: (question: string) => void;
  onClear: () => void;
  onClose: () => void;
  turns: ReadonlyArray<ChangeQuestionTurn>;
  visible: boolean;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((turn) => turn.status === 'loading');
  const lastTurn = turns.at(-1);

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
    }
  }, [visible]);

  // Keep the newest question and its progress in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [turns.length, lastTurn?.status]);

  const submit = (question = draft) => {
    if (busy || !question.trim()) {
      return;
    }
    onAsk(question);
    setDraft('');
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <section
      aria-hidden={!visible}
      aria-label={`Ask ${agentLabel} about this change`}
      className={`ask-panel${visible ? ' visible' : ''}`}
      inert={!visible}
      onKeyDown={onKeyDown}
      role="dialog"
    >
      <header className="ask-panel-header">
        <strong>Ask {agentLabel}</strong>
        <span className="ask-panel-hint">Investigates the full checkout, not just the diff</span>
        {turns.length > 0 ? (
          <button
            aria-label="Clear conversation"
            className="ask-panel-icon-button"
            disabled={busy}
            onClick={onClear}
            title="Clear conversation"
            type="button"
          >
            <Trash aria-hidden size={14} weight="bold" />
          </button>
        ) : null}
        <button
          aria-label="Close"
          className="ask-panel-icon-button"
          onClick={onClose}
          title="Close"
          type="button"
        >
          <X aria-hidden size={14} weight="bold" />
        </button>
      </header>
      <div className="ask-panel-turns" ref={listRef}>
        {turns.length === 0 ? (
          <div className="ask-panel-empty">
            <p>
              Ask about design, behavior, callers, history, or anything else about this change.{' '}
              {agentLabel} reads the code before answering.
            </p>
            <ul>
              {exampleQuestions.map((question) => (
                <li key={question}>
                  <button
                    className="ask-panel-example"
                    onClick={() => submit(question)}
                    type="button"
                  >
                    {question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          turns.map((turn) => (
            <article className="ask-panel-turn" key={turn.id}>
              <p className="ask-panel-question">{turn.question}</p>
              <div className={`ask-panel-answer${turn.status === 'error' ? ' error' : ''}`}>
                <AskAnswer agentLabel={agentLabel} turn={turn} />
              </div>
            </article>
          ))
        )}
      </div>
      <form
        className="ask-panel-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Question"
          className="ask-panel-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={turns.length > 0 ? 'Ask a follow-up…' : 'Ask about this change…'}
          ref={inputRef}
          rows={1}
          value={draft}
        />
        <button
          aria-label="Send"
          className="ask-panel-send"
          disabled={busy || !draft.trim()}
          title="Send"
          type="submit"
        >
          <ArrowUp aria-hidden size={14} weight="bold" />
        </button>
      </form>
    </section>
  );
}
