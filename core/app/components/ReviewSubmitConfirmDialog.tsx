import { useState, type FormEvent } from 'react';
import type { PullRequestReviewEvent } from '../../types.ts';
import { Button } from './Button.tsx';

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const getReviewEventLabel = (event: PullRequestReviewEvent) =>
  event === 'APPROVE' ? 'Approve' : event === 'COMMENT' ? 'Comment' : 'Request Changes';

/**
 * Asks before a pull request review is submitted, listing how many comments it
 * publishes and how many conversations are still unresolved.
 */
export function ReviewSubmitConfirmDialog({
  body,
  commentCount,
  event,
  onCancel,
  onConfirm,
  providerLabel,
  unresolvedThreadCount,
}: {
  body?: string;
  commentCount: number;
  event: PullRequestReviewEvent;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  providerLabel: string;
  unresolvedThreadCount: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const label = getReviewEventLabel(event);
  const title =
    event === 'APPROVE'
      ? `Approve this ${providerLabel}?`
      : event === 'COMMENT'
        ? 'Submit review comments?'
        : 'Request changes?';

  const handleSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="open-review-source-overlay"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget && !submitting) {
          onCancel();
        }
      }}
    >
      <form
        aria-describedby="review-submit-confirm-summary"
        aria-labelledby="review-submit-confirm-title"
        aria-modal="true"
        className="open-review-source-dialog review-submit-confirm-dialog"
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Escape' && !submitting) {
            keyEvent.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(formEvent) => void handleSubmit(formEvent)}
        role="dialog"
      >
        <div className="open-review-source-heading">
          <h2 id="review-submit-confirm-title">{title}</h2>
        </div>
        <ul className="review-submit-confirm-summary" id="review-submit-confirm-summary">
          <li data-kind="comments">
            <strong>{pluralize(commentCount, 'comment')}</strong>
            {commentCount === 0 ? ' to submit' : ' will be submitted'}
            {body ? ', plus a review summary' : ''}
          </li>
          <li data-kind="unresolved" data-warning={unresolvedThreadCount > 0 || undefined}>
            <strong>{pluralize(unresolvedThreadCount, 'unresolved conversation')}</strong>
            {unresolvedThreadCount === 0 ? '' : ' still open'}
          </li>
        </ul>
        <div className="open-review-source-actions">
          <Button disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            autoFocus
            className={`review-submit-confirm-button ${
              event === 'APPROVE' ? 'approve' : event === 'COMMENT' ? 'comment' : 'request-changes'
            }`}
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Submitting…' : label}
          </Button>
        </div>
      </form>
    </div>
  );
}
