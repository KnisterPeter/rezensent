import { Context } from "probot";
import { getConfig } from "../../config";
import { closePullRequest } from "../../github/close";
import { unblockPullRequest } from "../../github/commit-status";
import { deleteBranch } from "../../github/git";
import { Managed } from "../../matcher";
import { CancellationToken } from "../queue";

export async function handleLabelRemoved(
  context: Context,
  managed: Managed,
  token: CancellationToken
): Promise<boolean> {
  token.abortIfCanceled();
  const configuration = await getConfig(context, managed.head.ref);

  if (managed.labels.includes(configuration.manageReviewLabel)) {
    return false;
  }

  try {
    token.abortIfCanceled();
    const reviews = await managed.children();

    context.log.debug(
      reviews.map(
        (pr) => `PR-${pr.number} | ${pr.state.padEnd(6)} | ${pr.title}`
      ),
      `[${managed}] ${reviews.length} found review requests`
    );

    for (const review of reviews) {
      token.abortIfCanceled();
      await closePullRequest(context, review.number);

      token.abortIfCanceled();
      await deleteBranch(context, review.head.ref);
    }
  } finally {
    token.abortIfCanceled();
    await unblockPullRequest(context, managed);
  }

  return true;
}
