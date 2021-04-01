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
    })
  );

  const keys = Object.keys(config.config);
  if (keys.length === 0) {
    throw new Error("No config found");
  }

  const get = (key: string): string => {
    const value = (config.config as Record<string, string>)[key];
    if (!value) {
      throw new Error(`Required configuration '${key}' missing`);
    }
    return value;
  };

  return {
    manageReviewLabel: get("manage-review-label"),
    teamReviewLabel: get("team-review-label"),
  };
}
