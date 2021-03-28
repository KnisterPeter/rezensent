import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "./config";
import { createBotContext } from "./bot-context";
import {
  cloneRepo,
  getPullRequestCommits,
  getPullRequests,
  isReferencedPullRequest,
  PullRequest,
} from "./github";

export async function onPullRequestUpdated(
  context: EventTypesPayload["pull_request.synchronize"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    base: { ref: base },
    head: { ref: head, sha: headSha },
    merged,
  } = context.payload.pull_request;

  if (merged) {
    // ignore already merged branch updates
    return;
  }

  context.log.debug(`[PR-${number}] was updated`);

  const configuration = await getConfig(context, head);

  const { data: labels } = await context.octokit.issues.listLabelsOnIssue(
    context.repo({
      issue_number: number,
    })
  );

  const isTeamReviewPullRequest = labels
    .map((label) => label.name)
    .includes(configuration.teamReviewLabel);
  if (!isTeamReviewPullRequest) {
    context.log.debug(
      `[PR-${number}] ignoring, because not a team review request`
    );
    return;
  }

  const botContext = createBotContext(context);

  context.log.debug(`[PR-${number}] searching base pull request`);

  const basePullRequests = await getPullRequests(botContext, {
    params: {
      base,
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  let basePullRequest: PullRequest | undefined;
  for (const pullRequest of basePullRequests) {
    const isReferenced = await isReferencedPullRequest(botContext, {
      number: pullRequest.number,
      reference: number,
    });
    if (isReferenced) {
      basePullRequest = pullRequest;
      break;
    }
  }

  if (!basePullRequest) {
    context.log.debug(
      `[PR-${number}] ignoring merge, because no base pull request found`
    );
    return;
  }

  context.log.debug(
    `[PR-${number}] merging update into base pull request PR-${basePullRequest.number}`
  );

  const commits = await getPullRequestCommits(botContext, {
    number: basePullRequest.number,
  });

  const git = await cloneRepo(botContext, {
    branch: basePullRequest.head.ref,
    depth: commits.length + 1,
  });
  try {
    const newHeadSha = await git.mergeTheirs(head);

    if (newHeadSha !== headSha) {
      await git.push(basePullRequest.head.ref);
      context.log.debug(
        `[PR-${number}] changes integrated into base pull request`
      );
    } else {
      context.log.debug(
        `[PR-${number}] no changes to integrated into base pull request`
      );
    }
  } finally {
    await git.close();
  }
}
