import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { waitForPullRequestUpdate } from "../../github/wait-for-update";
import { closeManagedPullRequestIfEmpty } from "../../pr/managed";
import { match } from "../../pr/matcher";

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { number, merged } = context.payload.pull_request;

  if (!merged) {
    return;
  }

  context.log.debug(`[PR-${number}] was merged`);

  await match(context, number, {
    async review(review) {
      const managedPullRequest = await review.parent;

      context.log.debug(
        `[PR-${number}] merge base HEAD into managed pull request PR-${managedPullRequest.number}`
      );

      await context.octokit.pulls.updateBranch(
        context.repo({
          mediaType: {
            previews: ["lydian"],
          },
          pull_number: managedPullRequest.number,
        })
      );

      context.log.debug(
        `[PR-${number}] wait for managed pull request to get updated`
      );

      await waitForPullRequestUpdate(context, {
        pullRequest: managedPullRequest,
      });

      await closeManagedPullRequestIfEmpty(context, {
        number: managedPullRequest.number,
      });
    },
  });
}
