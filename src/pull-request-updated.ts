import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "./config";
import { createBotContext } from "./bot-context";
import { cloneRepo, getPullRequestCommits } from "./github";
import { findManagedPullRequest } from "./managed-pull-request";

export async function onPullRequestUpdated(
  context: EventTypesPayload["pull_request.synchronize"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head, sha: headSha },
    merged,
  } = context.payload.pull_request;

  if (merged) {
    // ignore already merged branch updates
    return;
  }

  context.log.debug(`[PR-${number}] was updated`);

  const configuration = await getConfig(context, head);

  const { data: labels } = await context.octokit.issues.listLabelsOnIssue(
    context.repo({
      issue_number: number,
    })
  );

  const isTeamReviewPullRequest = labels
    .map((label) => label.name)
    .includes(configuration.teamReviewLabel);
  if (!isTeamReviewPullRequest) {
    context.log.debug(
      `[PR-${number}] ignoring, because not a team review request`
    );
    return;
  }

  const botContext = createBotContext(context);

  const managedPullRequest = await findManagedPullRequest(botContext, {
    configuration,
    number,
  });
  if (!managedPullRequest) {
    context.log.debug(`[PR-${number}] ignoring merge`);
    return;
  }

  context.log.debug(
    `[PR-${number}] merging update into managed pull request PR-${managedPullRequest.number}`
  );

  const commits = await getPullRequestCommits(botContext, {
    number: managedPullRequest.number,
  });

  const git = await cloneRepo(botContext, {
    branch: managedPullRequest.head.ref,
    depth: commits.length + 1,
  });
  try {
    const newHeadSha = await git.mergeTheirs(head);

    if (newHeadSha !== headSha) {
      await git.push(managedPullRequest.head.ref);
      context.log.debug(
        `[PR-${number}] changes integrated into managed pull request`
      );
    } else {
      context.log.debug(
        `[PR-${number}] no changes to integrated into managed pull request`
      );
    }
  } finally {
    await git.close();
  }
}
