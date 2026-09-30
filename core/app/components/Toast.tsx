import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { XIcon as X } from '@phosphor-icons/react/X';
import { useEffect } from 'react';

export type ToastMessage = {
  href?: string;
  id: number;
  message: string;
};

const TOAST_DURATION_MS = 4000;

export function Toast({ onDismiss, toast }: { onDismiss: () => void; toast: ToastMessage | null }) {
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, toast]);

  if (!toast) {
    return null;
  }

  return (
    <div aria-live="polite" className="codiff-toast squircle" key={toast.id} role="status">
      <CheckCircle aria-hidden className="codiff-toast-icon" size={16} weight="fill" />
      {toast.href ? (
        <a className="codiff-toast-message" href={toast.href} rel="noreferrer" target="_blank">
          {toast.message}
        </a>
      ) : (
        <span className="codiff-toast-message">{toast.message}</span>
      )}
      <button
        aria-label="Dismiss"
        className="codiff-toast-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden size={12} weight="bold" />
      </button>
    </div>
  );
}
