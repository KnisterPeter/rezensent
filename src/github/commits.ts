import { Context } from "probot";

export async function getPullRequestCommits(
  context: Context,
  number: number
): Promise<{ sha: string; author?: string }[]> {
  return await context.octokit.paginate(
    context.octokit.pulls.listCommits,
    context.repo({
      pull_number: number,
      per_page: 100,
    }),
    ({ data: commits }) =>
      commits.map((commit) => ({
        sha: commit.sha,
        author: commit.commit.author?.name,
      }))
  );
}
