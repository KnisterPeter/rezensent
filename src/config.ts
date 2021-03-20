import type { Context } from "probot";

export interface Configuration {
  label: string;
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
        label: "Rezensent: Review",
      },
    })
  );

  return config.config;
}
