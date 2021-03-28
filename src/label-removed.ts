import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { createBotContext } from "./bot-context";
import { getConfig } from "./config";
import {
  closePullRequest,
  deleteBranch,
  getPullRequests,
  isReferencedPullRequest,
  PullRequest,
} from "./github";

export async function onLabelRemoved(
  context: EventTypesPayload["pull_request.unlabeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { name: removedLabel } = context.payload.label ?? {};
  const {
    number,
    base: { ref: base },
    head: { ref: head, sha: headSha },
  } = context.payload.pull_request;

  const botContext = createBotContext(context);
  const configuration = await getConfig(context, head);

  if (removedLabel !== configuration.manageReviewLabel) {
    context.log.debug(`[PR-${number}] not a managed pull request`);
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label removed`);

  const pullRequests = await getPullRequests(botContext, {
    params: {
      base,
      state: "open",
    },
    filters: {
      label: configuration.teamReviewLabel,
    },
  });

  const reviewRequests: PullRequest[] = [];
  for (const pullRequest of pullRequests) {
    const isReferenced = await isReferencedPullRequest(botContext, {
      number,
      reference: pullRequest.number,
    });
    if (isReferenced) {
      reviewRequests.push(pullRequest);
    }
  }

  context.log.debug(
    reviewRequests.map((pr) => pr.number),
    `[PR-${number}] found review requests`
  );

  for (const pullRequest of reviewRequests) {
    await closePullRequest(botContext, {
      number: pullRequest.number,
    });
    await deleteBranch(botContext, pullRequest.head.ref);
  }

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: headSha,
      context: "rezensent",
      description: "removed review label",
      state: "success",
    })
  );
}
