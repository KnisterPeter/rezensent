import { Context } from "probot";

export async function closePullRequest(
  context: Context,
  number: number
): Promise<void> {
  await context.octokit.pulls.update(
    context.repo({
      pull_number: number,
      state: "closed",
    })
  );
}
