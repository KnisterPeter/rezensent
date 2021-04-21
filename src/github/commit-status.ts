import type { WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import type { Managed } from "../matcher";

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
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
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
