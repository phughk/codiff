import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import { CaretUpIcon as CaretUp } from '@phosphor-icons/react/CaretUp';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import { formatLineCountNumber } from '../../lib/diff.ts';
import type { ScrollLineProgress as Progress } from '../../lib/review-scroll.ts';

// Matches Chromium's macOS overlay scrollbar: it hides 500ms after the last
// scroll and fades out over 250ms (see the CSS transition).
const HIDE_DELAY_MS = 500;

export type ScrollLineProgressHandle = {
  show: (progress: Progress) => void;
};

/**
 * A small box beside the scrollbar, shown while scrolling, with how many
 * changed lines are above and below the bottom of the viewport. It follows
 * the scroll position and updates through its handle so scrolling does not
 * re-render the diff.
 */
export function ScrollLineProgress({ ref }: { ref: Ref<ScrollLineProgressHandle> }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      show: (next) => {
        setProgress(next);
        setVisible(true);
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
      },
    }),
    [],
  );

  useEffect(
    () => () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    },
    [],
  );

  if (!progress) {
    return null;
  }

  return (
    <div
      aria-hidden
      className={`scroll-line-progress${visible ? ' visible' : ''}`}
      style={{ '--scroll-line-progress-position': progress.position } as CSSProperties}
    >
      <span className="scroll-line-progress-row">
        <CaretUp size={10} weight="fill" />
        {formatLineCountNumber(progress.read)}
      </span>
      <span className="scroll-line-progress-row">
        <CaretDown size={10} weight="fill" />
        {formatLineCountNumber(progress.left)}
      </span>
    </div>
  );
}
