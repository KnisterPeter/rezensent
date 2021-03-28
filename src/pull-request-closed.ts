import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { createBotContext } from "./bot-context";
import { getConfig } from "./config";
import { waitForPullRequestUpdate } from "./github";
import {
  closeManagedPullRequestIfEmpty,
  findManagedPullRequest,
} from "./managed-pull-request";

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

  await waitForPullRequestUpdate(botContext, {
    pullRequest: managedPullRequest,
  });

  await closeManagedPullRequestIfEmpty(botContext, {
    number: managedPullRequest.number,
  });
}
