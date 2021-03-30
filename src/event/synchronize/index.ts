import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "../../config";
import { withGit } from "../../github/clone";
import { getPullRequestCommits } from "../../github/commits";
import { createPullRequest } from "../../github/create";
import { getChangedFilesPerTeam } from "../../github/files";
import { getFilePatternMapPerTeam } from "../../ownership/codeowners";
import { match } from "../../pr/matcher";

export async function onPullRequestUpdated(
  context: EventTypesPayload["pull_request.synchronize"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head, sha: headSha },
    base: { ref: base },
    merged,
    title,
  } = context.payload.pull_request;

  if (merged) {
    // ignore already merged branch updates
    return;
  }

  context.log.debug(`[PR-${number}] was updated`);

  await match(context, number, {
    async managed(managed) {
      context.log.debug(
        `[PR-${managed.number}] update is managed pull request`
      );

      const reviewRequests = await managed.children;

      context.log.debug(
        reviewRequests.map((pr) => pr.number),
        `[PR-${number}] found review requests`
      );

      const patterns = await getFilePatternMapPerTeam(context, {
        branch: head,
      });

      const changedFilesByTeam = await getChangedFilesPerTeam(context, {
        number,
        patterns,
      });

      context.log.debug(
        Object.fromEntries(changedFilesByTeam.entries()),
        `[PR-${number}] files changed by team`
      );

      const commits = await getPullRequestCommits(context, {
        number,
      });
      const lastCommit = commits[0];
      const firstCommit = commits[commits.length - 1];

      context.log.debug({ commits }, `[PR-${number}] commits`);

      const configuration = await getConfig(context, head);

      await withGit(
        context,
        {
          branch: head,
          depth: commits.length + 1,
        },
        async (git) => {
          context.log.debug(`[PR-${number}] resetting branch`);
          const startPoint = await git.resetCommits(`${firstCommit}^`);

          for (const [team, files] of changedFilesByTeam) {
            if (files.length === 0) {
              continue;
            }

            context.log.debug(
              { team, files },
              `[PR-${number}] preparing changes`
            );
            const branch = `${head}-${team}`;

            const teamRequest = reviewRequests.find(
              (reviewRequest) => reviewRequest.head.ref === branch
            );

            if (teamRequest) {
              await git.addToExistingBranch({
                branch: teamRequest.head.ref,
                files,
              });
            } else {
              await git.addToNewBranch({
                branch,
                startPoint,
                files,
              });
            }

            await git.commitAndPush({
              message: `Updates from #${number} for ${team} (${lastCommit})`,
              branch,
            });

            // create new PR
            if (!teamRequest) {
              const teamPullRequestNumber = await createPullRequest(context, {
                branch,
                title: `${title} - ${team}`,
                body: `Splitted changes for ${team} from #${number}`,
                managedPullRequest: {
                  base,
                  head,
                  number,
                },
                label: configuration.teamReviewLabel,
              });

              context.log.debug(
                { team },
                `[PR-${number}] created team pull request PR-${teamPullRequestNumber}`
              );
            }
          }
        }
      );
    },

    async review(review) {
      context.log.debug(`[PR-${review.number}] update is team review request`);

      const managedPullRequest = await review.parent;

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
          `[PR-${number}] Update is referenced in managed pull request; keep commit`
        );
        return;
      }

      context.log.debug(
        `[PR-${number}] invalid commit ${commit.sha} onto team-pr; reset and cherry-pick onto PR-${managedPullRequest.number}`
      );

      const commits = await getPullRequestCommits(context, {
        number: number,
      });

      await withGit(
        context,
        {
          branch: head,
          depth: commits.length + 1,
        },
        async (git) => {
          context.log.debug(
            { commits },
            `[PR-${number}] Commits (reset to HEAD^ now)`
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
                issue_number: number,
                body: `Invalid commit on review pull request! We reset the branch!

    We cherry-picked your commit ${commit.sha} as ${newCommitId} onto #${managedPullRequest.number} instead.
    `,
              })
            );
          } catch {
            await context.octokit.issues.createComment(
              context.repo({
                issue_number: number,
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
