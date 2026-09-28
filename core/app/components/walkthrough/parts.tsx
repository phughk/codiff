import { BugIcon as Bug } from '@phosphor-icons/react/Bug';
import { FlaskIcon as Flask } from '@phosphor-icons/react/Flask';
import { GearIcon as Gear } from '@phosphor-icons/react/Gear';
import { PathIcon as Path } from '@phosphor-icons/react/Path';
import { ReadCvLogoIcon as Doc } from '@phosphor-icons/react/ReadCvLogo';
import { WrenchIcon as Wrench } from '@phosphor-icons/react/Wrench';
import type { ComponentType } from 'react';
import { renderInlineMarkdown } from '../../../lib/markdown.tsx';
import { importanceLabel } from '../../../lib/narrative-walkthrough.ts';
import type { WalkthroughIcon, WalkthroughStop } from '../../../types.ts';

type IconProps = {
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
};

const chapterIcons: Record<WalkthroughIcon, ComponentType<IconProps>> = {
  beaker: Flask,
  bug: Bug,
  doc: Doc,
  flask: Flask,
  gear: Gear,
  path: Path,
  wrench: Wrench,
};

export function ChapterIcon({ icon, size = 13 }: { icon: WalkthroughIcon; size?: number }) {
  const Icon = chapterIcons[icon] ?? chapterIcons.path;
  return <Icon size={size} />;
}

export function ImportancePill({ importance }: { importance: WalkthroughStop['importance'] }) {
  return <span className={`wt-importance ${importance}`}>{importanceLabel[importance]}</span>;
}

export function WalkthroughLineCount({ added, deleted }: { added: number; deleted: number }) {
  return (
    <span className="codiff-line-count">
      <span className="codiff-line-count-added">+{added}</span>
      {deleted > 0 ? <span className="codiff-line-count-deleted">−{deleted}</span> : null}
    </span>
  );
}

export function Narration({ prose }: { prose: string }) {
  return (
    <div className="wt-narration">
      <p className="wt-narration-prose">{renderInlineMarkdown(prose)}</p>
    </div>
  );
}

const stopChangeNoteLabels = [
  ['why', 'Why'],
  ['before', 'Before'],
  ['after', 'After'],
] as const;

export function StopChangeNotes({
  stop,
}: {
  stop: Pick<WalkthroughStop, 'after' | 'before' | 'why'>;
}) {
  const notes = stopChangeNoteLabels.flatMap(([key, label]) =>
    stop[key] ? [{ key, label, note: stop[key] }] : [],
  );
  if (notes.length === 0) {
    return null;
  }

  return (
    <dl className="wt-change-notes">
      {notes.map(({ key, label, note }) => (
        <div className={`wt-change-note ${key}`} key={key}>
          <dt>{label}</dt>
          <dd>{renderInlineMarkdown(note)}</dd>
        </div>
      ))}
    </dl>
  );
}
