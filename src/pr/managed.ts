import { Context } from "probot";

import { Configuration } from "../config";
import { closePullRequest } from "../github/close";
import { getPullRequestFiles } from "../github/files";
import { deleteBranch } from "../github/git";
import { Managed } from "./matcher";

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
  managed: Managed
): Promise<"open" | "closed"> {
  const files = await getPullRequestFiles(context, {
    number: managed.number,
  });
  context.log.debug(
    { files },
    `Managed pull request PR-${managed.number} files`
  );

  if (files.length > 0) {
    return "open";
  }

  context.log.debug(
    `Managed pull request PR-${managed.number} is empty; closing`
  );

  await closePullRequest(context, managed.number);
  await deleteBranch(context, managed.head.ref);

  return "closed";
}
