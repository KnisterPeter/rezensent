import { Context } from "probot";
import { Configuration } from "../config";

export async function isReviewPullRequest(
  context: Context,
  { configuration, number }: { configuration: Configuration; number: number }
): Promise<boolean> {
  const { data: labels } = await context.octokit.issues.listLabelsOnIssue(
    context.repo({
      issue_number: number,
    })
  );

  const hasTeamReviewLabel = labels
    .map((label) => label.name)
    .some((label) => label === configuration.teamReviewLabel);

  return hasTeamReviewLabel;
}
