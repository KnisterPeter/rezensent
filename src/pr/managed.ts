import { Context } from "probot";

import { Configuration } from "../config";
import { closePullRequest } from "../github/close";
import { getPullRequestFiles } from "../github/files";
import { deleteBranch } from "../github/git";

export async function isManagedPullRequest(
  context: Context,
  { configuration, number }: { configuration: Configuration; number: number }
): Promise<boolean> {
  const { data: labels } = await context.octokit.issues.listLabelsOnIssue(
    context.repo({
      issue_number: number,
    })
  );

  const hasManageReviewLabel = labels
    .map((label) => label.name)
    .some((label) => label === configuration.manageReviewLabel);

  return hasManageReviewLabel;
}

export async function closeManagedPullRequestIfEmpty(
  context: Context,
  { number }: { number: number }
): Promise<void> {
  const files = await getPullRequestFiles(context, {
    number,
  });
  context.log.debug({ files }, `Managed pull request PR-${number} files`);

  if (files.length === 0) {
    context.log.debug(`Managed pull request PR-${number} is empty; closing`);

    await closePullRequest(context, {
      number,
    });

    const { data: pr } = await context.octokit.pulls.get(
      context.repo({
        pull_number: number,
      })
    );

    await deleteBranch(context, pr.head.ref);
  }
}
