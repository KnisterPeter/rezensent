import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { getConfig } from "../config";
import { createManaged, PullRequestBase } from "../matcher";
import { setupBot } from "../setup";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

export async function onLabelRemoved(
  context: EventTypesPayload["pull_request.unlabeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { name: removedLabel } = context.payload.label ?? {};
  const {
    number,
    head: { ref: head },
    state,
    labels,
  } = context.payload.pull_request;

  context.log.debug(`[PR-${number}] was unlabeled`);

  if (!(await setupBot(context))) {
    return;
  }

  const configuration = await getConfig(context, head);

  if (removedLabel !== configuration.manageReviewLabel) {
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label removed`);

  const pr: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  const managed = createManaged(context, pr, configuration);

  enqueue(
    context,
    `unlabeled ${managed}`,
    synchronizeManaged(context, managed)
  );
}
