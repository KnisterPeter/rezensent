import { Context } from "probot";

import { closePullRequest } from "../github/close";
import { getPullRequestFiles } from "../github/files";
import { deleteBranch } from "../github/git";
import { Managed } from "./matcher";

export async function closeManagedPullRequestIfEmpty(
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
}
