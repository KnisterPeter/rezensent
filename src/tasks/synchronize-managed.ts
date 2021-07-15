import { Context } from "probot";
import { getConfig } from "../config";
import { withGit } from "../github/clone";
import { closePullRequest } from "../github/close";
import { Commit, getPullRequestCommits } from "../github/commits";
import { createPullRequest } from "../github/create";
import {
  getMapOfChangedFilesPerTeam,
  getPullRequestFiles,
} from "../github/files";
import { deleteBranch } from "../github/git";
import { Managed } from "../matcher";
import { getFilePatternMapPerTeam } from "../ownership/codeowners";
import { removeIndentation } from "../strings";
import { CancellationToken, Task } from "./queue";
import { handleLabelRemoved } from "./synchronize-managed/label-removed";
import {
  updateManaged,
  UpdateManagedResult,
} from "./synchronize-managed/update-managed";

export function synchronizeManaged(context: Context, managed: Managed): Task {
  const task = {
    name: synchronizeManaged.name,
    number: managed.number,

    async run(token: CancellationToken): Promise<void> {
      context.log.debug(`[${managed}] synchronize managed pull request`);

      const wasRemoved = await handleLabelRemoved(context, managed, token);
      if (wasRemoved) {
        return;
      }

      const updatedHead = await updateManaged(context, managed, token);
      switch (updatedHead) {
        case UpdateManagedResult.notFound:
          context.log.info(
            `[${managed}] no base branch; skip this synchronization`
          );
          break;

        case UpdateManagedResult.upToDate:
          const result = await this.closeManagedPullRequestIfEmpty(
            context,
            managed,
            token
          );
          if (result === "closed") {
            context.log.info(
              `[${managed}] closed; all changes are merged into ${managed.base.ref}`
            );
            return;
          }

          await task.updateReviews(managed, token);

          context.log.debug(`[${managed}] synchronized managed pull request`);
          break;

        case UpdateManagedResult.updated:
          context.log.info(
            `[${managed}] merged HEAD; wait for next synchronization`
          );
          break;
      }
    },

    async closeManagedPullRequestIfEmpty(
      context: Context,
      managed: Managed,
      token: CancellationToken
    ): Promise<"open" | "closed"> {
      token.abortIfCanceled();
      const files = await getPullRequestFiles(context, {
        number: managed.number,
      });
      context.log.debug({ files }, `[${managed}] files`);

      if (files.length > 0) {
        return "open";
      }

      context.log.debug(`[${managed}] is empty; closing`);

      token.abortIfCanceled();
      await closePullRequest(context, managed.number);

      token.abortIfCanceled();
      try {
        await deleteBranch(context, managed.head.ref);
      } catch {
        context.log.error(`[${managed}] head branch does not exist`);
      }

      return "closed";
    },

    async updateReviews(
      managed: Managed,
      token: CancellationToken
    ): Promise<void> {
      token.abortIfCanceled();
      const configuration = await getConfig(
        context,
        // use head if open, base if closed (branch could be delete already)
        managed.state === "open" ? managed.head.ref : managed.base.ref
      );

      token.abortIfCanceled();
      const reviews = await managed.children();
      context.log.info(
        reviews.map(
          (pr) => `PR-${pr.number} | ${pr.state.padEnd(6)} | ${pr.title}`
        ),
        `[${managed}] ${reviews.length} found review requests`
      );

      token.abortIfCanceled();
      const patterns = await getFilePatternMapPerTeam(context, {
        branch: managed.head.ref,
      });
      if (patterns.size === 0) {
        context.log.info(`[${managed}] no team patterns; aborting`);
        return;
      }

      token.abortIfCanceled();
      const changedFiles = await getPullRequestFiles(context, {
        number: managed.number,
      });
      const changedFilesByTeam = getMapOfChangedFilesPerTeam({
        changedFiles,
        patterns,
      });

      context.log.info(
        Object.fromEntries(changedFilesByTeam.entries()),
        `[${managed}] changes per team`
      );

      token.abortIfCanceled();
      let commits: Commit[];
      try {
        commits = await getPullRequestCommits(context, managed.number);
      } catch {
        context.log.error(`[${managed}] failed to read commits; aborting`);
        return;
      }

      token.abortIfCanceled();
      await withGit(
        context,
        { branch: managed.head.ref, depth: commits.length + 1 },
        async (git) => {
          for (const [team, files] of changedFilesByTeam) {
            if (files.length === 0) {
              continue;
            }

            const branch = `${managed.head.ref}-${team}`;
            const review = reviews.find((review) => review.head.ref === branch);
            const recreate = review?.state === "open";

            token.abortIfCanceled();
            await git.createReviewBranch({
              fromPullRequest: managed,
              toBranch: branch,
              files,
            });

            token.abortIfCanceled();
            await git.push({ branch, force: recreate });

            const title = `${managed.title} - ${team}`;
            const body = removeIndentation`
              Changes for :busts_in_silhouette: ${team} from #${managed.number}.

              :nerd_face: Please review the changes and merge them when you are fine with them. In case of required changes, please comment or push on #${
                managed.number
              }.

              ---

              **${managed.title}**

              ${managed.body ?? "No description provided."}

              ---

              :warning: Do **not** push onto this pull request, instead please add your change to #${
                managed.number
              }! This branch will be recreated when #${
              managed.number
            } changes and all manual changes will be lost.
            `;

            if (review && recreate) {
              token.abortIfCanceled();
              await context.octokit.pulls.update(
                context.repo({
                  pull_number: review.number,
                  title,
                  body,
                })
              );

              context.log.info(
                { team, review: `${review} | ${title}` },
                `[${managed}] updated review pull request`
              );
            } else {
              token.abortIfCanceled();
              const newPrNumber = await createPullRequest(context, {
                branch,
                title,
                body,
                managedPullRequest: {
                  base: managed.base.ref,
                  head: managed.head.ref,
                  number: managed.number,
                },
                label: configuration.teamReviewLabel,
              });

              context.log.info(
                { team, review: `PR-${newPrNumber} | ${title}` },
                `[${managed}] created new review pull request`
              );
            }
          }
        }
      );
    },
  };

  return task;
}
