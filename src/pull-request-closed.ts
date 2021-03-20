import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "./config";
import {
  cloneRepo,
  getPullRequestCommits,
  getPullRequests,
  isReferencedPullRequest,
} from "./github";

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    base: { ref: base },
    merged,
  } = context.payload.pull_request;

  if (!merged) {
    return;
  }

  // read config from base here, because head might already be deleted
  const configuration = await getConfig(context, base);

  const { data: labels } = await context.octokit.issues.listLabelsOnIssue(
    context.repo({
      issue_number: number,
    })
  );

  const isTeamReviewPullRequest = labels
    .map((label) => label.name)
    .includes(configuration.teamReviewLabel);
  if (!isTeamReviewPullRequest) {
    context.log.debug(`Ignoring PR ${number} merge`);
    return;
  }

  const repo = context.repo.bind(context);

  const basePullRequests = await getPullRequests({
    octokit: context.octokit,
    repo,
    params: {
      base,
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  const basePullRequest = basePullRequests.find((basePullRequest) =>
    isReferencedPullRequest({
      octokit: context.octokit,
      repo,
      number: basePullRequest.number,
      reference: number,
    })
  );

  if (!basePullRequest) {
    context.log.debug(
      `Ignoring PR ${number} merge; no base pull request found`
    );
    return;
  }

  const basePullRequestCommits = await getPullRequestCommits({
    octokit: context.octokit,
    repo,
    number: basePullRequest.number,
  });

  const git = await cloneRepo({
    octokit: context.octokit,
    repo,
    branch: basePullRequest.head.ref,
    depth: basePullRequestCommits.length + 1,
  });
  try {
    await git.rebase(basePullRequest.base.ref);
    await git.forcePush(basePullRequest.head.ref);
  } finally {
    await git.close();
  }
}
