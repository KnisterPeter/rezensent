import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { match } from "../pr/matcher";
import { enqueue } from "../tasks/queue";
import { synchronize } from "../tasks/synchronize";

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { number, merged } = context.payload.pull_request;

  context.log.debug(`[PR-${number}] was ${merged ? "merged" : "closed"}`);

  await match(context, number, {
    async review(review) {
      const managed = await review.parent();
      enqueue(context, `close ${review}`, synchronize(context, managed.number));
    },
  });
}
