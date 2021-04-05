import { Context } from "probot";
import { Managed } from "../matcher";

export async function blockPullRequest(
  context: Context,
  managed: Managed
): Promise<void> {
  await setCommitStatus(
    context,
    managed.head.sha,
    "pending",
    "pull request is managed"
  );
}

export async function unblockPullRequest(
  context: Context,
  managed: Managed
): Promise<void> {
  await setCommitStatus(
    context,
    managed.head.sha,
    "success",
    "pull request not managed"
  );
}

export async function setCommitStatus(
  context: Context,
  sha: string,
  state: "success" | "pending" | "error",
  description: string
): Promise<void> {
  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha,
      context: "rezensent",
      state,
      description,
    })
  );
}
