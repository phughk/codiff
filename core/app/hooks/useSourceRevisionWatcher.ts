import { useEffect, useState } from 'react';
import { hasMovableRefs } from '../../lib/source.ts';
import type { RepositoryState } from '../../types.ts';

const POLL_INTERVAL = 5000;

// Branch comparisons and ranges are resolved to commits once, so their diff goes
// stale when a ref behind them moves: a new commit, a fetch, a rebase. The
// repository watcher only sees the working tree, so re-resolve these sources
// while the window is in use and report when the view no longer matches.
export function useSourceRevisionWatcher(state: RepositoryState | null, paused: boolean) {
  const [staleRevision, setStaleRevision] = useState<string | null>(null);
  const source = state?.source;
  const revision = state?.revision;

  useEffect(() => {
    if (!source || !revision || paused || !hasMovableRefs(source)) {
      return;
    }

    let canceled = false;
    let checking = false;
    const check = () => {
      if (checking || document.hidden || !document.hasFocus()) {
        return;
      }
      checking = true;
      window.codiff
        .getSourceRevision(source)
        .then((nextRevision) => {
          if (!canceled && nextRevision != null && nextRevision !== revision) {
            setStaleRevision(revision);
          }
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    };

    const interval = window.setInterval(check, POLL_INTERVAL);
    window.addEventListener('focus', check);
    return () => {
      canceled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [paused, revision, source]);

  // Keyed on the revision so a refresh that loads a newer one clears it.
  return revision != null && staleRevision === revision;
}
