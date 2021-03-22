import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { createBotContext } from "./bot-context";
import { getConfig } from "./config";
import {
  closePullRequest,
  getPullRequestFiles,
  getPullRequests,
  isReferencedPullRequest,
  PullRequest,
  waitForPullRequestUpdate,
} from "./github";

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

  context.log.debug(`[PR-${number}] searching base pull request`);

  const basePullRequests = await getPullRequests(botContext, {
    params: {
      base,
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  let basePullRequest: PullRequest | undefined;
  for (const pullRequest of basePullRequests) {
    const isReferenced = await isReferencedPullRequest(botContext, {
      number: pullRequest.number,
      reference: number,
    });
    if (isReferenced) {
      basePullRequest = pullRequest;
      break;
    }
  }

  if (!basePullRequest) {
    context.log.debug(
      `[PR-${number}] ignoring merge, because no base pull request found`
    );
    return;
  }

  context.log.debug(
    `[PR-${number}] merge base HEAD into base pull request PR-${basePullRequest.number}`
  );

  await context.octokit.pulls.updateBranch(
    context.repo({
      mediaType: {
        previews: ["lydian"],
      },
      pull_number: basePullRequest.number,
    })
  );

  context.log.debug(`[PR-${number}] wait for pull request to get updated`);

  await waitForPullRequestUpdate(botContext, {
    pullRequest: basePullRequest,
  });

  const files = await getPullRequestFiles(botContext, {
    number: basePullRequest.number,
  });

  if (files.length === 0) {
    context.log.debug(`[PR-${number}] base pull request is empty; closing`);

    await closePullRequest(botContext, {
      number: basePullRequest.number,
    });
  }
}
