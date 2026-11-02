import type { CodeViewHandle } from '@pierre/diffs/react';
import type { ReactNode } from 'react';
import type { CodiffAgentBackend } from '../config/types.ts';
import type {
  AgentActivity,
  AgentReviewSeverity,
  ChangedFile,
  DiffSection,
  NarrativeWalkthrough,
  NarrativeWalkthroughResult,
  PullRequestCodeQualityFinding,
  PullRequestExistingReviewComment,
  ReviewSource,
} from '../types.ts';

export type WalkthroughError = Extract<NarrativeWalkthroughResult, { status: 'unavailable' }>;

export type ReviewCommentAnnotationMetadata = {
  commentIds: ReadonlyArray<string>;
  type: 'review-comment';
};

export type CodeQualityAnnotationMetadata = {
  finding: PullRequestCodeQualityFinding;
  type: 'code-quality';
};

type MarkdownPreviewAnnotationMetadata = {
  contents: string;
  editing: boolean;
  layoutKey: string;
  oldContents?: string;
  path: string;
  sectionId: string;
  type: 'markdown-preview';
};

type GraphvizPreviewAnnotationMetadata = {
  after: string | null;
  before: string | null;
  sectionId: string;
  type: 'graphviz-preview';
};

type ImagePreviewAnnotationMetadata = {
  path: string;
  sectionId: string;
  type: 'image-preview';
};

type WalkthroughHeaderAnnotationMetadata = {
  header: ReactNode;
  type: 'walkthrough-header';
};

export type ReviewAnnotationMetadata =
  | CodeQualityAnnotationMetadata
  | GraphvizPreviewAnnotationMetadata
  | ImagePreviewAnnotationMetadata
  | MarkdownPreviewAnnotationMetadata
  | ReviewCommentAnnotationMetadata
  | WalkthroughHeaderAnnotationMetadata;

export type CodeViewInstance = NonNullable<
  ReturnType<CodeViewHandle<ReviewAnnotationMetadata, undefined>['getInstance']>
>;

export type DiffSearchMatch = {
  filePath: string;
  itemId: string;
  lineNumber?: number;
  side?: 'additions' | 'deletions';
};

export type DiffSearchResult = {
  file: ChangedFile;
  matchCount: number;
  matches: ReadonlyArray<DiffSearchMatch>;
};

export type ReviewScrollBehavior = 'instant' | 'smooth';

export type ReviewScrollTarget = {
  behavior?: ReviewScrollBehavior;
  blockId?: string;
  commentId?: string;
  path?: string;
  request: number;
};

export type ReviewIdentity = {
  coverage?: {
    allHunkIds: ReadonlyArray<string>;
    file: { fingerprint: string; key: string };
    hunkIds: ReadonlyArray<string>;
  };
  fingerprint: string;
  key: string;
};

export type DiffLineCount = {
  additions: number;
  countable: boolean;
  deletions: number;
};

export type ReviewComment = {
  /** Set on comments an agent left from Review with agent; `body` is the agent's text until edited. */
  agentReview?: {
    agentId: CodiffAgentBackend;
    originalBody: string;
    severity: AgentReviewSeverity;
  };
  anchor?: 'file' | 'line';
  author?: PullRequestExistingReviewComment['author'];
  body: string;
  canDelete?: boolean;
  canEdit?: boolean;
  canReplyThread?: boolean;
  canResolveThread?: boolean;
  /** Follow-up questions to the agent after its first reply, oldest first. */
  codexFollowUps?: ReadonlyArray<{
    /** Steps the agent took while investigating, in order. */
    activity?: ReadonlyArray<AgentActivity>;
    error?: string;
    question: string;
    reply?: string;
    status: 'error' | 'loading' | 'ready';
  }>;
  codexReply?: {
    /** Steps the agent took while investigating, in order. */
    activity?: ReadonlyArray<AgentActivity>;
    body?: string;
    error?: string;
    status: 'error' | 'loading' | 'ready';
  };
  filePath: string;
  id: string;
  isOutdated?: boolean;
  isPending?: boolean;
  isReadOnly?: boolean;
  isThreadResolved?: boolean;
  lineNumber?: number;
  remoteSubmit?: {
    error?: string;
    status: 'error' | 'submitting';
  };
  sectionId: string;
  /**
   * Set on notes for the agent session that reads them with `codiff sessions`. They stay out of
   * the review and copied comments, and collect the agent's replies.
   */
  session?: {
    replies?: ReadonlyArray<SessionCommentReply>;
  };
  side?: 'additions' | 'deletions';
  startLineNumber?: number;
  startSide?: 'additions' | 'deletions';
  submittedAt?: string;
  threadId?: string;
  url?: string;
};

export type SessionCommentReply = {
  agentId?: CodiffAgentBackend;
  body: string;
  createdAt: number;
};

export type SidebarMode = 'tree' | 'walkthrough' | 'history';

export type PullRequestSource = Extract<ReviewSource, { type: 'pull-request' }>;

export type WalkthroughNote = {
  action: 'review' | 'scan' | 'skim';
  context: string;
  groupReason: string;
  groupTitle: string;
  impact: 'wide' | 'contained' | 'mechanical';
  order: number;
  reason: string;
};

export type SourceSession = {
  collapsed: Set<string>;
  expandedReviewKeys: Set<string>;
  /** Populated by a generated or pre-authored narrative walkthrough document. */
  narrativeWalkthrough?: NarrativeWalkthrough | null;
  reviewComments: ReadonlyArray<ReviewComment>;
  selectedPath: string | null;
  viewed: Record<string, string>;
  walkthroughError: WalkthroughError | null;
  walkthroughFiles: ReadonlyArray<{
    fingerprint: string;
    path: string;
    status: ChangedFile['status'];
  }>;
};

export type RepositoryLoadError = {
  kind: 'generic' | 'not-a-repository';
  message: string;
};

export type CodeViewItemMetadata = {
  blockId: string;
  canEditMarkdown: boolean;
  canRenderGraph: boolean;
  canRenderMarkdown: boolean;
  comments: ReadonlyArray<ReviewComment>;
  file: ChangedFile;
  isCollapsed: boolean;
  isGraphPreview: boolean;
  isMarkdownPreview: boolean;
  isSelected: boolean;
  isViewed: boolean;
  lineCount: DiffLineCount;
  reviewIdentity: ReviewIdentity;
  section: DiffSection;
  sectionCount: number;
  walkthroughNote?: WalkthroughNote;
};
