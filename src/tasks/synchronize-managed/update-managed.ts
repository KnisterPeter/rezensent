import { Context } from "probot";
import { Managed } from "../../matcher";
import { CancellationToken } from "../queue";

export enum UpdateManagedResult {
  notFound,
  upToDate,
  updated,
}

export async function updateManaged(
  context: Context,
  managed: Managed,
  token: CancellationToken
): Promise<UpdateManagedResult> {
  token.abortIfCanceled();
  let base: { object: { sha: string } };

  try {
    const { data } = await context.octokit.git.getRef(
      context.repo({
        ref: `heads/${managed.base.ref}`,
      })
    );
    base = data;
  } catch {
    context.log.error(`[${managed}] head branch not found`);
    return UpdateManagedResult.notFound;
  }

  if (base.object.sha === managed.base.sha) {
    return UpdateManagedResult.upToDate;
  }

  context.log.debug(
    {
      HEAD: `${base.object.sha} (${managed.base.ref})`,
      ref: `${managed.base.sha} (${managed.head.ref})`,
    },
    `[${managed}] update branch; merge HEAD`
  );

  token.abortIfCanceled();
  await context.octokit.pulls.updateBranch(
    context.repo({
      mediaType: {
        previews: ["lydian"],
      },
      pull_number: managed.number,
    })
  );

  return UpdateManagedResult.updated;
}
