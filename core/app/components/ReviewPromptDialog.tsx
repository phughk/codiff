import { useState, type FormEvent } from 'react';
import { Button } from './Button.tsx';

/**
 * Edits `settings.reviewPrompt`: extra instructions added to the prompt the
 * agent gets when it reviews the diff with Review.
 */
export function ReviewPromptDialog({
  agentLabel,
  initialPrompt,
  onClose,
  onSave,
}: {
  agentLabel: string;
  initialPrompt: string;
  onClose: () => void;
  onSave: (prompt: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(initialPrompt);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(value.trim());
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the review prompt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="open-review-source-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <form
        aria-describedby="review-prompt-description"
        aria-labelledby="review-prompt-title"
        aria-modal="true"
        className="open-review-source-dialog review-prompt-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !saving) {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }
        }}
        onSubmit={(event) => void handleSubmit(event)}
        role="dialog"
      >
        <div className="open-review-source-heading">
          <h2 id="review-prompt-title">Review Prompt</h2>
          <p id="review-prompt-description">
            Extra instructions for {agentLabel} when it reviews the diff, such as what to focus on,
            what to skip, or the tone of comments. They are added to the built-in review prompt.
            Leave empty to use only the built-in prompt.
          </p>
        </div>
        <div className="open-review-source-field">
          <textarea
            aria-describedby={error ? 'review-prompt-error' : undefined}
            aria-label="Review instructions"
            autoFocus
            className="open-review-source-input review-prompt-input"
            disabled={saving}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
            placeholder="For example: Focus on security and data loss. Skip naming nits. Point out missing tests."
            rows={8}
            value={value}
          />
          {error ? (
            <p className="open-review-source-error" id="review-prompt-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="open-review-source-actions">
          <Button disabled={saving} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={saving} type="submit">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
