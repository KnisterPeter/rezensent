import { BotContext } from "./bot-context";
import { Configuration } from "./config";
import {
  closePullRequest,
  deleteBranch,
  getPullRequestFiles,
  getPullRequests,
  isReferencedPullRequest,
  PullRequest,
} from "./github";

export async function isManagedPullRequest(
  { octokit, repo }: BotContext,
  { configuration, number }: { configuration: Configuration; number: number }
): Promise<boolean> {
  const { data: labels } = await octokit.issues.listLabelsOnIssue(
    repo({
      issue_number: number,
    })
  );

  const hasManageReviewLabel = labels
    .map((label) => label.name)
    .some((label) => label === configuration.manageReviewLabel);

  return hasManageReviewLabel;
}

export async function closeManagedPullRequestIfEmpty(
  context: BotContext,
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

export async function findManagedPullRequest(
  context: BotContext,
  { configuration, number }: { configuration: Configuration; number: number }
): Promise<PullRequest | undefined> {
  context.log.debug(`[PR-${number}] searching managed pull request`);

  const { data: pr } = await context.octokit.pulls.get(
    context.repo({ pull_number: number })
  );

  const managedPullRequests = await getPullRequests(context, {
    params: {
      base: pr.base.ref,
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  let managedPullRequest: PullRequest | undefined;

  for (const pullRequest of managedPullRequests) {
    const isReferenced = await isReferencedPullRequest(context, {
      number: pullRequest.number,
      reference: number,
    });
    if (isReferenced) {
      managedPullRequest = pullRequest;
      break;
    }
  }

  if (!managedPullRequest) {
    context.log.debug(`No managed pull request found`);
    return;
  }

  const isManaged = await isManagedPullRequest(context, {
    configuration,
    number: managedPullRequest.number,
  });

  if (!isManaged) {
    context.log.debug(
      `Invalid managed pull request PR-${managedPullRequest.number}`
    );
    return;
  }

  return managedPullRequest;
}
