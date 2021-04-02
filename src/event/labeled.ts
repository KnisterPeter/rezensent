import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { match, PullRequestBase } from "../matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

/**
 * Called when a label is added to a pull request.
 */
export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    label: { name: label } = {},
    pull_request: { number, state, labels },
  } = context.payload;

  context.log.debug({ label }, `[PR-${number}] was labeled`);

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async managed(managed) {
      enqueue(
        context,
        `label added to PR-${managed.number}`,
        synchronizeManaged(context, managed)
      );
    },
  });
}
