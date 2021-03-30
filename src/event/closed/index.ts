import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "../../config";
import { waitForPullRequestUpdate } from "../../github/wait-for-update";
import {
  closeManagedPullRequestIfEmpty,
  findManagedPullRequest,
} from "../../pr/managed";

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    base: { ref: base },
    merged,
  } = context.payload.pull_request;

  if (!merged) {
    return;
  }

  context.log.debug(`[PR-${number}] was merged`);

  // read config from base here, because head might already be deleted
  const configuration = await getConfig(context, base);

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

  const managedPullRequest = await findManagedPullRequest(context, {
    configuration,
    number,
  });
  if (!managedPullRequest) {
    context.log.debug(`[PR-${number}] ignoring merge`);
    return;
  }

  context.log.debug(
    `[PR-${number}] merge base HEAD into managed pull request PR-${managedPullRequest.number}`
  );

  await context.octokit.pulls.updateBranch(
    context.repo({
      mediaType: {
        previews: ["lydian"],
      },
      pull_number: managedPullRequest.number,
    })
  );

  context.log.debug(
    `[PR-${number}] wait for managed pull request to get updated`
  );

  await waitForPullRequestUpdate(context, {
    pullRequest: managedPullRequest,
  });

  await closeManagedPullRequestIfEmpty(context, {
    number: managedPullRequest.number,
  });
}
