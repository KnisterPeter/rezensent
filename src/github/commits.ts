import { Context } from "probot";

export async function getPullRequestCommits(
  context: Context,
  number: number
): Promise<string[]> {
  return await context.octokit.paginate(
    context.octokit.pulls.listCommits,
    context.repo({
      pull_number: number,
      per_page: 100,
    }),
    ({ data: commits }) => commits.map((commit) => commit.sha)
  );
}
