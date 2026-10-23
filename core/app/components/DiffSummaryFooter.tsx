import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { getDiffSummary, type DiffFileCategory } from '../../lib/diff-summary.ts';
import { formatLineCountNumber, getDiffLineCountTitle } from '../../lib/diff.ts';
import type { ChangedFile } from '../../types.ts';
import { DiffLineCountBadge } from './DiffLineCountBadge.tsx';

const collapsedStorageKey = 'codiff:diff-summary-collapsed';
const categories = [
  ['prod', 'Prod', 'Application code and runtime resources'],
  ['tests', 'Tests', 'Tests, helpers, mocks, fixtures, and snapshots'],
  ['other', 'Other', 'Documentation, scripts, tooling, dependencies, and other files'],
] satisfies ReadonlyArray<readonly [DiffFileCategory, string, string]>;

const readCollapsed = () => {
  try {
    return localStorage.getItem(collapsedStorageKey) === 'true';
  } catch {
    return false;
  }
};

export function DiffSummaryFooter({
  children,
  files,
  loading = false,
  showWhitespace,
}: {
  children?: ReactNode;
  files: ReadonlyArray<ChangedFile>;
  loading?: boolean;
  showWhitespace: boolean;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const breakdownId = useId();
  const summary = useMemo(
    () => getDiffSummary(loading ? [] : files, showWhitespace),
    [files, loading, showWhitespace],
  );
  const expanded = !collapsed;
  const toggleLabel = collapsed ? 'Expand change breakdown' : 'Collapse change breakdown';

  return (
    <div aria-busy={loading || undefined} className="sidebar-summary-footer">
      <div className="sidebar-summary-stats">
        {expanded ? (
          <dl aria-label="Change breakdown" className="sidebar-summary-breakdown" id={breakdownId}>
            {categories.map(([category, label, description]) => {
              const lineCount = summary.categories[category];
              return (
                <div
                  key={category}
                  title={
                    summary.total.countable
                      ? `${description}: ${getDiffLineCountTitle(lineCount)}`
                      : description
                  }
                >
                  <dt>{label}</dt>
                  <dd className={summary.total.countable ? 'codiff-line-count-added' : undefined}>
                    {summary.total.countable
                      ? `+${formatLineCountNumber(lineCount.additions)}`
                      : '—'}
                  </dd>
                  <dd className={summary.total.countable ? 'codiff-line-count-deleted' : undefined}>
                    {summary.total.countable
                      ? `-${formatLineCountNumber(lineCount.deletions)}`
                      : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        <button
          aria-controls={expanded ? breakdownId : undefined}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="sidebar-total-summary"
          onClick={() => {
            const nextCollapsed = !collapsed;
            setCollapsed(nextCollapsed);
            try {
              localStorage.setItem(collapsedStorageKey, String(nextCollapsed));
            } catch {
              // Keep the preference in memory if browser storage is unavailable.
            }
          }}
          title={toggleLabel}
          type="button"
        >
          <span>Total:</span>
          {summary.total.countable ? (
            <DiffLineCountBadge
              ariaLabelPrefix="Total change"
              className="sidebar-total-line-count"
              lineCount={summary.total}
            />
          ) : (
            <span
              className="sidebar-total-empty"
              title={loading ? 'Loading changes…' : 'No countable line changes'}
            >
              —
            </span>
          )}
          <CaretDown
            aria-hidden
            className={expanded ? 'summary-chevron expanded' : 'summary-chevron'}
            size={12}
            weight="bold"
          />
        </button>
      </div>
      {children}
    </div>
  );
}
