import { Context } from "probot";
import { Managed } from "../matcher";

export async function blockPullRequest(
  context: Context,
  managed: Managed
): Promise<void> {
  await setCommitStatus(context, managed, "pending", "pull request is managed");
}

export async function unblockPullRequest(
  context: Context,
  managed: Managed
): Promise<void> {
  await setCommitStatus(
    context,
    managed,
    "success",
    "pull request not managed"
  );
}

async function setCommitStatus(
  context: Context,
  managed: Managed,
  state: "success" | "pending",
  description: string
): Promise<void> {
  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: managed.head.sha,
      context: "rezensent",
      state,
      description,
    })
  );
}
