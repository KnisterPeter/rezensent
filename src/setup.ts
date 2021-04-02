import type { Context } from "probot";
import { getConfig } from "./config";

export async function setupBot(
  context: Context,
  branch: string
): Promise<void> {
  const configuration = await getConfig(context, branch);

  const { data: labels } = await context.octokit.issues.listLabelsForRepo(
    context.repo()
  );

  const hasManageReviewLabel = labels
    .map((label) => label.name)
    .includes(configuration.manageReviewLabel);
  if (!hasManageReviewLabel) {
    await context.octokit.issues.createLabel(
      context.repo({
        name: configuration.manageReviewLabel,
        description:
          "Label to let the rezensent know to take over the review management",
      })
    );
  }
}
