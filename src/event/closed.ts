import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { match, PullRequestBase } from "../pr/matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { number, merged, state, labels } = context.payload.pull_request;

  context.log.debug(`[PR-${number}] was ${merged ? "merged" : "closed"}`);

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async review(review) {
      const managed = await review.parent();
      enqueue(context, `close ${review}`, synchronizeManaged(context, managed));
    },
  });
}
