import { Context } from "probot";
import { getCredentials, withGit } from "../github/clone";
import { getPullRequestCommits } from "../github/commits";
import { Review } from "../matcher";
import { CancellationToken, Task } from "./queue";

export function synchronizeReview(context: Context, review: Review): Task {
  const task = {
    name: synchronizeReview.name,
    number: review.number,

    async run(token: CancellationToken): Promise<void> {
      context.log.debug(`[${review}] synchronize review pull request`);

      token.abortIfCanceled();
      const { name } = await getCredentials(context.octokit);

      token.abortIfCanceled();
      const commits = await getPullRequestCommits(context, review.number);

      const manualCommits = commits.filter((commit) => commit.author !== name);

      if (manualCommits.length === 0) {
        context.log.info(`[${review}] no manual commits found`);
        return;
      }

      token.abortIfCanceled();
      const managed = await review.parent();

      context.log.info(
        {
          commits: manualCommits.map(
            (commit) => `${commit.sha} | ${commit.author}`
          ),
          managed: `${managed}`,
        },
        `[${review}] invalid commits; move to managed pull request`
      );

      token.abortIfCanceled();
      await withGit(
        context,
        {
          branch: review.head.ref,
          depth: commits.length + 1,
        },
        async (git) => {
          const commits = manualCommits.map((commit) => commit.sha);

          try {
            await git.moveCommits({
              toBranch: managed.head.ref,
              commits,
            });

            await context.octokit.issues.createComment(
              context.repo({
                issue_number: review.number,
                body: `Invalid commit on review pull request! We reset the branch!
We cherry-picked your commits ${commits.join(", ")} onto #${
                  managed.number
                } instead.
`,
              })
            );
          } catch {
            await context.octokit.issues.createComment(
              context.repo({
                issue_number: review.number,
                body: `Invalid commit on review pull request! We reset the branch!
MERGE-CONFLICT: Please cherry-pick your commits ${commits.join(", ")} onto #${
                  managed.number
                } instead.
`,
              })
            );
          }

          await git.removeCommits({
            pullRequest: review,
            amount: manualCommits.length,
          });
        }
      );
    },
  };

  return task;
}
