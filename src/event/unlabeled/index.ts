import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "../../config";
import { closePullRequest } from "../../github/close";
import { getPullRequests } from "../../github/get";
import { deleteBranch } from "../../github/git";
import { isReferencedPullRequest } from "../../github/is-referenced";
import { PullRequest } from "../../github/pr";

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

  const configuration = await getConfig(context, head);

  if (removedLabel !== configuration.manageReviewLabel) {
    context.log.debug(`[PR-${number}] not a managed pull request`);
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label removed`);

  const pullRequests = await getPullRequests(context, {
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
    const isReferenced = await isReferencedPullRequest(context, {
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
    await closePullRequest(context, {
      number: pullRequest.number,
    });
    await deleteBranch(context, pullRequest.head.ref);
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
