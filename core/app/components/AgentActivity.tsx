import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/CaretDown';
import { DotsThreeIcon as DotsThree } from '@phosphor-icons/react/DotsThree';
import { FileTextIcon as FileText } from '@phosphor-icons/react/FileText';
import { FolderOpenIcon as FolderOpen } from '@phosphor-icons/react/FolderOpen';
import { GitCommitIcon as GitCommit } from '@phosphor-icons/react/GitCommit';
import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { TerminalWindowIcon as TerminalWindow } from '@phosphor-icons/react/TerminalWindow';
import type { AgentActivity } from '../../types.ts';

const agentActivityIcons: Record<AgentActivity['kind'], typeof FileText> = {
  command: TerminalWindow,
  history: GitCommit,
  list: FolderOpen,
  other: DotsThree,
  read: FileText,
  search: MagnifyingGlass,
};

export const formatStepCount = (count: number) => `${count} ${count === 1 ? 'step' : 'steps'}`;

export function AgentActivityStep({ step }: { step: AgentActivity }) {
  const Icon = agentActivityIcons[step.kind] ?? DotsThree;
  return (
    <>
      <Icon aria-hidden className="agent-activity-icon" size={13} weight="bold" />
      <span className="agent-activity-label">{step.label}</span>
      {step.detail ? <code className="agent-activity-detail">{step.detail}</code> : null}
    </>
  );
}

/**
 * The agent's investigation, collapsed under its answer. The answer stays the
 * focus; reviewers can open this to check what the agent looked at.
 */
export function AgentActivityDisclosure({ activity }: { activity: ReadonlyArray<AgentActivity> }) {
  return (
    <details className="agent-activity">
      <summary className="agent-activity-summary">
        <CaretDown aria-hidden className="agent-activity-caret" size={11} weight="bold" />
        Investigated in {formatStepCount(activity.length)}
      </summary>
      <ol className="agent-activity-list">
        {activity.map((step, index) => (
          <li className="agent-activity-step" key={index}>
            <AgentActivityStep step={step} />
          </li>
        ))}
      </ol>
    </details>
  );
}
