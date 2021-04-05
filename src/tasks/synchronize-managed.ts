import { Endpoints } from "@octokit/types";
import { Context } from "probot";
import { getConfig } from "../config";
import { withGit } from "../github/clone";
import { closePullRequest } from "../github/close";
import { getPullRequestCommits } from "../github/commits";
import { createPullRequest } from "../github/create";
import { getChangedFilesPerTeam, getPullRequestFiles } from "../github/files";
import { deleteBranch } from "../github/git";
import { Managed } from "../matcher";
import { getFilePatternMapPerTeam } from "../ownership/codeowners";
import { Task } from "./queue";

export function synchronizeManaged(context: Context, managed: Managed): Task {
  const task = {
    name: synchronizeManaged.name,
    number: managed.number,

    async run(): Promise<void> {
      context.log.debug(`[${managed}] synchronize managed pull request`);

      const updatedHead = await updateFromHead(context, managed);
      switch (updatedHead) {
        case UpdateFromHeadResult.notFound:
          context.log.info(
            `[${managed}] no head branch; skip this synchronization`
          );
          break;

        case UpdateFromHeadResult.upToDate:
          const result = await this.closeManagedPullRequestIfEmpty(
            context,
            managed
          );
          if (result === "closed") {
            context.log.info(
              `[${managed}] closed; all changes are merged into ${managed.base.ref}`
            );
            return;
          }

          await task.updateReviews(managed);

          context.log.debug(`[${managed}] synchronized managed pull request`);
          break;

        case UpdateFromHeadResult.updated:
          context.log.info(
            `[${managed}] merged HEAD; wait for next synchronization`
          );
          break;
      }
    },

    async closeManagedPullRequestIfEmpty(
      context: Context,
      managed: Managed
    ): Promise<"open" | "closed"> {
      const files = await getPullRequestFiles(context, {
        number: managed.number,
      });
      context.log.debug({ files }, `[${managed}] files`);

      if (files.length > 0) {
        return "open";
      }

      context.log.debug(`[${managed}] is empty; closing`);

      await closePullRequest(context, managed.number);
      await deleteBranch(context, managed.head.ref);

      return "closed";
    },

    async updateReviews(managed: Managed): Promise<void> {
      const configuration = await getConfig(
        context,
        // use head if open, base if closed (branch could be delete already)
        managed.state === "open" ? managed.head.ref : managed.base.ref
      );

      const reviews = await managed.children();
      context.log.info(
        reviews.map(
          (pr) => `PR-${pr.number} | ${pr.state.padEnd(6)} | ${pr.title}`
        ),
        `[${managed}] ${reviews.length} found review requests`
      );

      const patterns = await getFilePatternMapPerTeam(context, {
        branch: managed.head.ref,
      });

      const changedFilesByTeam = await getChangedFilesPerTeam(context, {
        number: managed.number,
        patterns,
      });

      context.log.info(
        Object.fromEntries(changedFilesByTeam.entries()),
        `[${managed}] changes per team`
      );

      const commits = await getPullRequestCommits(context, managed.number);

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

            if (review && review.state === "open") {
              await git.updateReviewBranch({
                fromPullRequest: managed,
                toBranch: branch,
                team,
                files,
              });

              await git.push(branch);

              context.log.info(
                { team, review: `${review} | ${review.title}` },
                `[${managed}] updated review pull request`
              );
            } else {
              await git.createReviewBranch({
                fromPullRequest: managed,
                toBranch: branch,
                team,
                files,
              });

              await git.push(branch);

              const title = `${managed.title} - ${team}`;
              const newPrNumber = await createPullRequest(context, {
                branch,
                title,
                body: `Changes for ${team} from #${managed.number}`,
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

enum UpdateFromHeadResult {
  upToDate,
  updated,
  notFound,
}

async function updateFromHead(
  context: Context,
  managed: Managed
): Promise<UpdateFromHeadResult> {
  let head: Endpoints["GET /repos/{owner}/{repo}/git/ref/{ref}"]["response"]["data"];
  try {
    const { data } = await context.octokit.git.getRef(
      context.repo({
        ref: `heads/${managed.base.ref}`,
      })
    );
    head = data;
  } catch {
    context.log.error(`[${managed}] head branch not found`);
    return UpdateFromHeadResult.notFound;
  }

  if (head.object.sha === managed.base.sha) {
    return UpdateFromHeadResult.upToDate;
  }

  context.log.debug(
    {
      HEAD: `${head.object.sha} (${managed.base.ref})`,
      ref: `${managed.base.sha} (${managed.head.ref})`,
    },
    `[${managed}] update branch; merge HEAD`
  );

  await context.octokit.pulls.updateBranch(
    context.repo({
      mediaType: {
        previews: ["lydian"],
      },
      pull_number: managed.number,
    })
  );

  return UpdateFromHeadResult.updated;
}
