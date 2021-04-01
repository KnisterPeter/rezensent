import { Context } from "probot";
import { Configuration, getConfig } from "../config";
import { Git } from "../git";
import { withGit } from "../github/clone";
import { getPullRequestCommits } from "../github/commits";
import { createPullRequest } from "../github/create";
import { getChangedFilesPerTeam } from "../github/files";
import { getFilePatternMapPerTeam } from "../ownership/codeowners";
import { closeManagedPullRequestIfEmpty } from "../pr/managed";

import { Managed, match, Review } from "../pr/matcher";
import { Task } from "./queue";

export function synchronize(context: Context, number: number): Task {
  const task = {
    name: synchronize.name,
    number,

    async run(): Promise<void> {
      await match(context, number, {
        async managed(managed) {
          context.log.debug(`[${managed}] synchronize managed pull request`);

          if (await task.updateFromHead(managed)) {
            context.log.info(
              `[${managed}] merged HEAD; wait for next synchronization`
            );
            return;
          }

          const result = await closeManagedPullRequestIfEmpty(context, managed);
          if (result === "closed") {
            context.log.info(
              `[${managed}] closed; all changes are merged into ${managed.base.ref}`
            );
            return;
          }

          await task.updateReviews(managed);

          context.log.debug(`[${managed}] synchronized managed pull request`);
        },
      });
    },

    async updateFromHead(managed: Managed): Promise<boolean> {
      const { data: head } = await context.octokit.git.getRef(
        context.repo({
          ref: `heads/${managed.base.ref}`,
        })
      );

      if (head.object.sha === managed.base.sha) {
        return false;
      }

      context.log.debug(
        `[${managed}] merge ${managed.base.ref} into ${managed.head.ref}`
      );

      await context.octokit.pulls.updateBranch(
        context.repo({
          mediaType: {
            previews: ["lydian"],
          },
          pull_number: managed.number,
        })
      );

      return true;
    },

    async updateReviews(managed: Managed): Promise<void> {
      const configuration = await getConfig(
        context,
        // use head if open, base if closed (branch could be delete already)
        managed.state === "open" ? managed.head.ref : managed.base.ref
      );

      const reviews = await managed.children();

      const patterns = await getFilePatternMapPerTeam(context, {
        branch: managed.head.ref,
      });

      const changedFilesByTeam = await getChangedFilesPerTeam(context, {
        number: managed.number,
        patterns,
      });

      context.log.debug(
        Object.fromEntries(changedFilesByTeam.entries()),
        `[${managed}] changes per team`
      );

      const commits = await getPullRequestCommits(context, managed.number);
      const firstCommit = commits[commits.length - 1];

      await withGit(
        context,
        { branch: managed.head.ref, depth: commits.length + 1 },
        async (git) => {
          const startPoint = await git.resetCommits(`${firstCommit}^`);

          for (const [team, files] of changedFilesByTeam) {
            if (files.length === 0) {
              continue;
            }

            context.log.info(`[${managed}] update review for ${team}`);

            await this.updateReview(managed, reviews, {
              git,
              startPoint,
              team,
              files,
              configuration,
            });
          }
        }
      );
    },

    async updateReview(
      managed: Managed,
      reviews: Review[],
      {
        git,
        startPoint,
        team,
        files,
        configuration,
      }: {
        git: Git;
        startPoint: string;
        team: string;
        files: string[];
        configuration: Configuration;
      }
    ): Promise<void> {
      const branch = `${managed.head.ref}-${team}`;

      const review = reviews.find((review) => review.head.ref === branch);

      if (review) {
        await git.addToExistingBranch({
          branch: review.head.ref,
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
        message: `Updates from #${managed.number} for ${team}`,
        branch,
      });

      if (review) {
        return;
      }

      // create new PR
      await createPullRequest(context, {
        branch,
        title: `${managed.title} - ${team}`,
        body: `Changes for ${team} from #${managed.number}`,
        managedPullRequest: {
          base: managed.base.ref,
          head: managed.head.ref,
          number: managed.number,
        },
        label: configuration.teamReviewLabel,
      });
    },
  };

  return task;
}
