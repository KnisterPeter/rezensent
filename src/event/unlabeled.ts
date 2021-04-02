import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "../config";
import { closePullRequest } from "../github/close";
import { deleteBranch } from "../github/git";
import { createManaged, PullRequestBase } from "../pr/matcher";

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
  const reviews = await managed.children();

  context.log.debug(
    reviews.map(
      (pr) => `PR-${pr.number} | ${pr.state.padEnd(6)} | ${pr.title}`
    ),
    `[${managed}] found review requests`
  );

  for (const review of reviews) {
    await closePullRequest(context, review.number);
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
