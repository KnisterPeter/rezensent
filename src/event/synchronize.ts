import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { match, PullRequestBase } from "../matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";
import { synchronizeReview } from "../tasks/synchronize-review";

export async function onPullRequestUpdated(
  context: EventTypesPayload["pull_request.synchronize"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { number, merged, state, labels } = context.payload.pull_request;

  if (merged) {
    // ignore already merged branch updates
    return;
  }

  context.log.debug(`[PR-${number}] was updated`);

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async managed(managed) {
      enqueue(
        context,
        `updated branch ${managed}`,
        synchronizeManaged(context, managed)
      );
    },

    async review(review) {
      enqueue(
        context,
        `update branch ${review}`,
        synchronizeReview(context, review)
      );
    },
  });
}
