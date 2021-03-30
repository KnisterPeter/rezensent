import { Context } from "probot";

export async function deleteBranch(
  context: Context,
  branch: string
): Promise<void> {
  await context.octokit.git.deleteRef(
    context.repo({
      ref: `heads/${branch}`,
    })
  );
}
