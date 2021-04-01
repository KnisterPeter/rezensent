import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { match } from "../pr/matcher";

import { enqueue } from "../tasks/queue";
import { synchronize } from "../tasks/synchronize";

/**
 * Called when a label is added to a pull request.
 */
export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { number } = context.payload.pull_request;

  await match(context, number, {
    async managed(managed) {
      enqueue(
        context,
        `label added to PR-${managed.number}`,
        synchronize(context, managed.number)
      );
    },
  });
}