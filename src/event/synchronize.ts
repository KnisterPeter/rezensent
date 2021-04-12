import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { blockPullRequest } from "../github/commit-status";
import { match, PullRequestBase } from "../matcher";
import { setupBot } from "../setup";
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

  if (!(await setupBot(context))) {
    return;
  }

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async managed(managed) {
      await blockPullRequest(context, managed);

      enqueue(
        context,
        `updated ${managed}`,
        synchronizeManaged(context, managed)
      );
    },

    async review(review) {
      enqueue(context, `update ${review}`, synchronizeReview(context, review));
    },
  });
}
