import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "../config";
import { closePullRequest } from "../github/close";
import { deleteBranch } from "../github/git";
import { PullRequest } from "../github/pr";
import { createManaged } from "../pr/matcher";

export async function onLabelRemoved(
  context: EventTypesPayload["pull_request.unlabeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { name: removedLabel } = context.payload.label ?? {};
  const {
    number,
    head: { ref: head },
  } = context.payload.pull_request;

  const configuration = await getConfig(context, head);

  if (removedLabel !== configuration.manageReviewLabel) {
    context.log.debug(`[PR-${number}] not a managed pull request`);
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label removed`);

  const pr = context.payload.pull_request as PullRequest;
  const managed = createManaged(context, pr, configuration);
  const reviewRequests = await managed.children();

  context.log.debug(
    reviewRequests.map((pr) => pr.number),
    `[PR-${number}] found review requests`
  );

  for (const review of reviewRequests) {
    await closePullRequest(context, {
      number: review.number,
    });
    await deleteBranch(context, review.head.ref);
  }

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: managed.head.sha,
      context: "rezensent",
      description: "removed review label",
      state: "success",
    })
  );
}
