import type { Context } from "probot";

export interface Configuration {
  manageReviewLabel: string;
  teamReviewLabel: string;
}

export async function getConfig(
  context: Context,
  branch: string
): Promise<Configuration> {
  const config = await context.octokit.config.get(
    context.repo({
      path: ".github/rezensent.yml",
      branch,
      defaults: {
        "manage-review-label": "Rezensent: Managed Review",
        "team-review-label": "Rezensent: Team Review Requested",
      },
    })
  );

  return {
    manageReviewLabel: config.config["manage-review-label"],
    teamReviewLabel: config.config["team-review-label"],
  };
}
