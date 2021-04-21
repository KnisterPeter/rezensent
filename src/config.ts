import type { WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

export interface Configuration {
  manageReviewLabel: string;
  teamReviewLabel: string;
}

export function mapYamlToConfiguration(
  input: Record<string, string>
): Configuration {
  const get = (key: string): string => {
    const value = input[key];
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

export async function getConfig(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  branch: string
): Promise<Configuration> {
  const config = await context.octokit.config.get(
    context.repo({
      path: ".github/rezensent.yml",
      branch,
    })
  );
  if (Object.keys(config.config).length === 0) {
    throw new Error(`No config found no branch '${branch}'`);
  }

  return mapYamlToConfiguration(config.config as Record<string, string>);
}
