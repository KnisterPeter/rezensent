import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { withGit } from "../github/clone";
import { getPullRequestCommits } from "../github/commits";
import { match, PullRequestBase } from "../pr/matcher";
import { enqueue } from "../tasks/queue";
import { synchronize } from "../tasks/synchronize";

export async function onPullRequestUpdated(
  context: EventTypesPayload["pull_request.synchronize"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head, sha: headSha },
    merged,
    state,
    labels,
  } = context.payload.pull_request;

  if (merged) {
    // ignore already merged branch updates
    return;
  }

  context.log.debug(`[PR-${number}] was updated`);

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async managed(managed) {
      enqueue(
        context,
        `updated branch ${managed}`,
        synchronize(context, managed)
      );
    },

    async review(review) {
      context.log.debug(`[${review}] update is team review request`);

      const managedPullRequest = await review.parent();

      const { data: commit } = await context.octokit.git.getCommit(
        context.repo({
          commit_sha: headSha,
        })
      );

      const managedTimeline = await context.octokit.paginate(
        context.octokit.issues.listEventsForTimeline,
        context.repo({
          mediaType: {
            previews: ["mockingbird"],
          },
          issue_number: managedPullRequest.number,
          per_page: 100,
        })
      );
      const referencedCommits = managedTimeline
        .filter((item) => item.event === "referenced")
        .map((item) => item.commit_id);

      if (referencedCommits.includes(commit.sha)) {
        context.log.debug(
          `[${review}] Update is referenced in managed pull request; keep commit`
        );
        return;
      }

      context.log.debug(
        `[${review}] invalid commit ${commit.sha} onto team-pr; reset and cherry-pick onto PR-${managedPullRequest.number}`
      );

      const commits = await getPullRequestCommits(context, review.number);

      await withGit(
        context,
        {
          branch: head,
          depth: commits.length + 1,
        },
        async (git) => {
          context.log.debug(
            { commits },
            `[${review}] Commits (reset to HEAD^ now)`
          );

          await git.resetHardCommits();
          await git.forcePush(head);

          try {
            const newCommitId = await git.cherryPick({
              commit: commit.sha,
              onto: managedPullRequest.head.ref,
            });
            await context.octokit.issues.createComment(
              context.repo({
                issue_number: review.number,
                body: `Invalid commit on review pull request! We reset the branch!

    We cherry-picked your commit ${commit.sha} as ${newCommitId} onto #${managedPullRequest.number} instead.
    `,
              })
            );
          } catch {
            await context.octokit.issues.createComment(
              context.repo({
                issue_number: review.number,
                body: `Invalid commit on review pull request! We reset the branch!

    Please cherry-pick your commit ${commit.sha} onto #${managedPullRequest.number} instead.
    `,
              })
            );
          }
        }
      );
    },
  });
}
