import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "./config";

export async function onPullRequestMerged(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head },
  } = context.payload.pull_request;

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
    context.log.debug(`Ignoring PR ${number} merge`);
    return;
  }

  // todo: update base pr
}
