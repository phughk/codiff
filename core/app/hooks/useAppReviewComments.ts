import { useCallback, useState, type RefObject } from 'react';
import type { CodiffAgentBackend } from '../../config/types.ts';
import type { ReviewComment } from '../../lib/app-types.ts';
import {
  getPendingPullRequestReviewComments,
  getReviewCommentRangeProps,
  isAgentConversationComment,
  toPullRequestReviewComment,
} from '../../lib/review-comments.ts';
import { getSourceKey } from '../../lib/source.ts';
import type {
  AgentReviewComment,
  PullRequestReviewEvent,
  PullRequestReviewStatus,
  RepositoryState,
  ReviewAssistantRequest,
} from '../../types.ts';
import { useReviewCommentDrafts } from './useReviewCommentDrafts.ts';

export type AgentReviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { commentCount: number; status: 'ready'; summary: string }
  | { reason: string; status: 'error' };

const toAgentReviewComment = (
  comment: AgentReviewComment,
  agentId: CodiffAgentBackend,
): ReviewComment => ({
  agentReview: { agentId, originalBody: comment.body, severity: comment.severity },
  body: comment.body,
  filePath: comment.filePath,
  id: crypto.randomUUID(),
  lineNumber: comment.lineNumber,
  sectionId: comment.sectionId,
  side: comment.side,
});

// A rerun replaces the agent's earlier comments unless the reviewer edited them.
const isUntouchedAgentReviewComment = (comment: ReviewComment) =>
  comment.agentReview != null &&
  !comment.isReadOnly &&
  comment.remoteSubmit == null &&
  comment.body === comment.agentReview.originalBody;

type UseAppReviewCommentsOptions = {
  isReviewActionDisabled: (
    reviewStatus: PullRequestReviewStatus | undefined,
    event: PullRequestReviewEvent,
  ) => boolean;
  onCommentFileChange: (filePath: string) => void;
  stateRef: RefObject<RepositoryState | null>;
};

export function useAppReviewComments({
  isReviewActionDisabled,
  onCommentFileChange,
  stateRef,
}: UseAppReviewCommentsOptions) {
  const [reviewComments, setReviewComments] = useState<ReadonlyArray<ReviewComment>>([]);
  // Keyed by source so a review never shows against a different diff.
  const [agentReviewBySource, setAgentReviewBySource] = useState<{
    sourceKey: string;
    state: AgentReviewState;
  } | null>(null);
  const [pullRequestReviewSubmitting, setPullRequestReviewSubmitting] =
    useState<PullRequestReviewEvent | null>(null);
  const commentDrafts = useReviewCommentDrafts({
    comments: reviewComments,
    onCommentFileChange,
    setComments: setReviewComments,
  });
  const {
    activeReviewCommentDraftRef,
    activeReviewCommentDraftState,
    clearCommentFocus,
    reviewCommentsRef,
    updateActiveReviewCommentDraft,
  } = commentDrafts;

  const updateCodexReply = useCallback(
    (commentId: string, filePath: string, codexReply: NonNullable<ReviewComment['codexReply']>) => {
      setReviewComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                codexReply,
              }
            : comment,
        ),
      );
      onCommentFileChange(filePath);
    },
    [onCommentFileChange],
  );

  const updateRemoteSubmit = useCallback(
    (commentId: string, remoteSubmit: ReviewComment['remoteSubmit']) => {
      setReviewComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                remoteSubmit,
              }
            : comment,
        ),
      );
      const comment = reviewCommentsRef.current.find((candidate) => candidate.id === commentId);
      if (comment) {
        onCommentFileChange(comment.filePath);
      }
    },
    [onCommentFileChange, reviewCommentsRef],
  );

  const updateCodexFollowUp = useCallback(
    (
      commentId: string,
      filePath: string,
      index: number,
      followUp: NonNullable<ReviewComment['codexFollowUps']>[number],
    ) => {
      setReviewComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                codexFollowUps: [
                  ...(comment.codexFollowUps ?? []).slice(0, index),
                  followUp,
                  ...(comment.codexFollowUps ?? []).slice(index + 1),
                ],
              }
            : comment,
        ),
      );
      onCommentFileChange(filePath);
    },
    [onCommentFileChange],
  );

  /**
   * Asks the agent about a note. With `followUp`, continues the conversation
   * under the agent's reply; without it, starts a new one.
   */
  const askCodex = useCallback(
    (commentId: string, followUp?: string) => {
      const currentState = stateRef.current;
      const comment = reviewCommentsRef.current.find((candidate) => candidate.id === commentId);
      const question = followUp?.trim() ?? '';
      const followUps = comment?.codexFollowUps ?? [];
      if (
        !currentState ||
        !comment ||
        comment.body.trim().length === 0 ||
        comment.codexReply?.status === 'loading' ||
        (followUp != null &&
          (!question ||
            comment.codexReply?.status !== 'ready' ||
            followUps.some((turn) => turn.status === 'loading')))
      ) {
        return;
      }

      const conversation = followUp
        ? [
            { body: comment.codexReply?.body ?? '', role: 'agent' as const },
            ...followUps.flatMap((turn) =>
              turn.status === 'ready' && turn.reply
                ? [
                    { body: turn.question, role: 'reviewer' as const },
                    { body: turn.reply, role: 'agent' as const },
                  ]
                : [],
            ),
          ]
        : [];
      const request: ReviewAssistantRequest = {
        comment: {
          body: comment.body,
          filePath: comment.filePath,
          ...(comment.lineNumber != null ? { lineNumber: comment.lineNumber } : {}),
          sectionId: comment.sectionId,
          ...(comment.side ? { side: comment.side } : {}),
          ...getReviewCommentRangeProps(comment),
        },
        ...(followUp ? { conversation, followUp: question } : {}),
        source: currentState.source,
      };

      const index = followUps.length;
      const settle = (reply: { error?: string; reply?: string }) => {
        const status = reply.reply != null ? ('ready' as const) : ('error' as const);
        if (followUp) {
          updateCodexFollowUp(comment.id, comment.filePath, index, { question, ...reply, status });
        } else {
          updateCodexReply(comment.id, comment.filePath, {
            ...(reply.reply != null ? { body: reply.reply } : { error: reply.error }),
            status,
          });
        }
      };

      if (followUp) {
        updateCodexFollowUp(comment.id, comment.filePath, index, { question, status: 'loading' });
      } else {
        setReviewComments((current) =>
          current.map((candidate) =>
            candidate.id === comment.id
              ? { ...candidate, codexFollowUps: undefined, codexReply: { status: 'loading' } }
              : candidate,
          ),
        );
        onCommentFileChange(comment.filePath);
      }
      void window.codiff
        .askReviewAssistant(request)
        .then((result) =>
          settle(result.status === 'ready' ? { reply: result.reply } : { error: result.reason }),
        )
        .catch((error: unknown) =>
          settle({ error: error instanceof Error ? error.message : String(error) }),
        );
    },
    [onCommentFileChange, reviewCommentsRef, stateRef, updateCodexFollowUp, updateCodexReply],
  );

  const reviewWithAgent = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState) {
      return;
    }

    const sourceKey = getSourceKey(currentState.source);
    const setAgentReview = (state: AgentReviewState) =>
      setAgentReviewBySource({ sourceKey, state });
    const isCurrentSource = () =>
      stateRef.current != null && getSourceKey(stateRef.current.source) === sourceKey;
    setAgentReview({ status: 'loading' });
    void window.codiff
      .reviewDiffWithAgent({ source: currentState.source })
      .then((result) => {
        if (!isCurrentSource()) {
          return;
        }
        if (result.status !== 'ready') {
          setAgentReview({ reason: result.reason, status: 'error' });
          return;
        }

        const comments = result.comments.map((comment) =>
          toAgentReviewComment(comment, result.agentId),
        );
        const changedPaths = new Set(comments.map((comment) => comment.filePath));
        for (const comment of reviewCommentsRef.current) {
          if (isUntouchedAgentReviewComment(comment)) {
            changedPaths.add(comment.filePath);
          }
        }
        setReviewComments((current) => [
          ...current.filter((comment) => !isUntouchedAgentReviewComment(comment)),
          ...comments,
        ]);
        for (const path of changedPaths) {
          onCommentFileChange(path);
        }
        setAgentReview({
          commentCount: comments.length,
          status: 'ready',
          summary: result.summary,
        });
      })
      .catch((error: unknown) => {
        if (isCurrentSource()) {
          setAgentReview({
            reason: error instanceof Error ? error.message : String(error),
            status: 'error',
          });
        }
      });
  }, [onCommentFileChange, reviewCommentsRef, stateRef]);

  const getAgentReviewState = useCallback(
    (sourceKey: string): AgentReviewState =>
      agentReviewBySource?.sourceKey === sourceKey ? agentReviewBySource.state : { status: 'idle' },
    [agentReviewBySource],
  );

  const submitComment = useCallback(
    (commentId: string, pending: boolean) => {
      const currentState = stateRef.current;
      const comment = reviewCommentsRef.current.find((candidate) => candidate.id === commentId);
      if (
        currentState?.source.type !== 'pull-request' ||
        !comment ||
        isAgentConversationComment(comment) ||
        comment.body.trim().length === 0 ||
        comment.remoteSubmit?.status === 'submitting'
      ) {
        return;
      }

      updateRemoteSubmit(comment.id, { status: 'submitting' });
      updateActiveReviewCommentDraft(null);
      void window.codiff
        .submitPullRequestComment({
          comment: toPullRequestReviewComment(comment),
          ...(pending ? { pending: true } : {}),
          source: currentState.source,
        })
        .then((submittedComment) => {
          clearCommentFocus(comment.id);
          setReviewComments((current) =>
            current.map((candidate) =>
              candidate.id === comment.id
                ? {
                    author: submittedComment.author,
                    body: submittedComment.body,
                    filePath: submittedComment.filePath,
                    id: submittedComment.id,
                    ...(submittedComment.isPending ? { isPending: true } : {}),
                    isReadOnly: true,
                    ...(submittedComment.anchor === 'file' ? { anchor: 'file' as const } : {}),
                    ...(submittedComment.lineNumber != null
                      ? { lineNumber: submittedComment.lineNumber }
                      : {}),
                    sectionId: comment.sectionId,
                    ...(submittedComment.side ? { side: submittedComment.side } : {}),
                    ...getReviewCommentRangeProps(submittedComment),
                    submittedAt: submittedComment.submittedAt,
                    url: submittedComment.url,
                  }
                : candidate,
            ),
          );
          onCommentFileChange(comment.filePath);
        })
        .catch((error: unknown) => {
          updateRemoteSubmit(comment.id, {
            error: error instanceof Error ? error.message : String(error),
            status: 'error',
          });
        });
    },
    [
      clearCommentFocus,
      onCommentFileChange,
      reviewCommentsRef,
      stateRef,
      updateActiveReviewCommentDraft,
      updateRemoteSubmit,
    ],
  );

  const submitPullRequestComment = useCallback(
    (commentId: string) => submitComment(commentId, false),
    [submitComment],
  );

  const submitPendingPullRequestComment = useCallback(
    (commentId: string) => submitComment(commentId, true),
    [submitComment],
  );

  const submitPullRequestReview = useCallback(
    (event: PullRequestReviewEvent, body?: string) => {
      const currentState = stateRef.current;
      if (
        currentState?.source.type !== 'pull-request' ||
        pullRequestReviewSubmitting ||
        isReviewActionDisabled(currentState.source.reviewStatus, event)
      ) {
        return;
      }

      const pendingComments = getPendingPullRequestReviewComments(
        reviewCommentsRef.current,
        activeReviewCommentDraftRef.current,
      );
      const hasRemotePendingComments = reviewCommentsRef.current.some(
        (comment) => comment.isPending,
      );
      if (
        event === 'COMMENT' &&
        pendingComments.length === 0 &&
        !hasRemotePendingComments &&
        !body?.trim()
      ) {
        return;
      }
      const pendingCommentIds = new Set(pendingComments.map((comment) => comment.id));
      setPullRequestReviewSubmitting(event);
      return window.codiff
        .submitPullRequestReview({
          ...(body ? { body } : {}),
          comments: pendingComments.map((comment) => toPullRequestReviewComment(comment)),
          event,
          source: currentState.source,
        })
        .then(() => {
          updateActiveReviewCommentDraft(null);
          // Submitting the review publishes the comments that were pending on
          // GitHub along with the drafts sent in this request.
          setReviewComments((current) =>
            current.flatMap((comment) => {
              if (pendingCommentIds.has(comment.id)) {
                return [];
              }
              if (comment.isPending) {
                const { isPending: _isPending, ...published } = comment;
                return [published];
              }
              return [comment];
            }),
          );
        })
        .catch((error: unknown) => {
          window.alert(error instanceof Error ? error.message : String(error));
          throw error;
        })
        .finally(() => {
          setPullRequestReviewSubmitting(null);
        });
    },
    [
      activeReviewCommentDraftRef,
      isReviewActionDisabled,
      pullRequestReviewSubmitting,
      reviewCommentsRef,
      stateRef,
      updateActiveReviewCommentDraft,
    ],
  );

  const hasPendingReviewComments =
    reviewComments.some((comment) => comment.isPending) ||
    getPendingPullRequestReviewComments(reviewComments, activeReviewCommentDraftState).length > 0;

  return {
    ...commentDrafts,
    askCodex,
    getAgentReviewState,
    hasPendingReviewComments,
    pullRequestReviewSubmitting,
    reviewComments,
    reviewWithAgent,
    setReviewComments,
    submitPendingPullRequestComment,
    submitPullRequestComment,
    submitPullRequestReview,
  };
}
