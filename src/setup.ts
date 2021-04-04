import { promises as fsp } from "fs";
import { load } from "js-yaml";
import { dirname, join } from "path";
import type { Context } from "probot";
import { getConfig, mapYamlToConfiguration } from "./config";
import { getCredentials, withGit } from "./github/clone";

const title = "Configure rezensent";
const onboardingBranch = "rezensent/setup";
const configFile = ".github/rezensent.yml";

export async function setupBot(context: Context): Promise<boolean> {
  const {
    data: { name: repo, default_branch },
  } = await context.octokit.repos.get(context.repo({}));

  try {
    const configuration = await getConfig(context, default_branch);

    const {
      data: labelObjects,
    } = await context.octokit.issues.listLabelsForRepo(context.repo());
    const labels = labelObjects.map((label) => label.name);

    const hasManageReviewLabel = labels.includes(
      configuration.manageReviewLabel
    );
    if (!hasManageReviewLabel) {
      context.log.debug("[Onboarding] create managed pull request label");

      await context.octokit.issues.createLabel(
        context.repo({
          name: configuration.manageReviewLabel,
          description:
            "Label to let the rezensent know to take over the review management",
        })
      );
    }

    const hasTeamReviewLabel = labels.includes(configuration.teamReviewLabel);
    if (!hasTeamReviewLabel) {
      context.log.debug("[Onboarding] create team review pull request label");

      await context.octokit.issues.createLabel(
        context.repo({
          name: configuration.teamReviewLabel,
          description: "Label to let the teams know what to review",
        })
      );
    }

    context.log.debug("[Onboarding] done");

    return true;
  } catch {
    try {
      await runOnboarding(context, repo, default_branch);
    } catch (err) {
      context.log.error(
        err,
        "[Onboarding] failed, continue without onboarding"
      );
      return true;
    }
  }
  return false;
}

async function runOnboarding(
  context: Context,
  repo: string,
  branch: string
): Promise<void> {
  if (!(await requireOnboarding(context, repo, branch))) {
    return;
  }

  await withGit(context, { branch, depth: 1 }, async (git) => {
    const configTemplate = await fsp.readFile(
      join(__dirname, "./templates/rezensent.yml"),
      "utf-8"
    );
    const configYaml: Record<string, string> = load(configTemplate) as any;
    const configuration = mapYamlToConfiguration(configYaml);

    const onboardingTemplate = await fsp.readFile(
      join(__dirname, "./templates/onboarding.md"),
      "utf-8"
    );

    const configPath = join(git.directory, configFile);
    await fsp.mkdir(dirname(configPath), {
      recursive: true,
    });
    await fsp.writeFile(configPath, configTemplate);

    await git.addToNewBranch({ branch: onboardingBranch, files: [configFile] });
    await git.commitAndPush({
      branch: onboardingBranch,
      message: "chore: configure rezensent",
    });

    const { data: pr } = await context.octokit.pulls.create(
      context.repo({
        base: branch,
        head: onboardingBranch,
        title,
        // https://regex101.com/r/J2aqvf/1
        body: onboardingTemplate.replace(
          /^\s*{{\slabels\s}}\n/gms,
          [
            `  - **${configuration.manageReviewLabel}** as label for managed pull requests`,
            `  - **${configuration.teamReviewLabel}** as label for team review requests`,
          ].join("\n")
        ),
      })
    );

    context.log.info(`Created onboarding pr ${pr.number}`);
  });
}

async function requireOnboarding(
  context: Context,
  repo: string,
  branch: string
): Promise<boolean> {
  const user = await getCredentials(context.octokit);

  const pullRequests = await context.octokit.paginate(
    context.octokit.pulls.list,
    context.repo({
      base: branch,
      head: `${repo}:${onboardingBranch}`,
      per_page: 100,
    })
  );
  const onboardingPr = pullRequests.find(
    (pullRequest) =>
      pullRequest.title === title && pullRequest.user?.login === user.login
  );

  context.log.debug({ onboarding: onboardingPr }, "Onboarding pull request");

  if (onboardingPr?.state === "open") {
    context.log.info(`Found open onboarding; wait to be merged`);
    return false;
  }
  if (onboardingPr?.merged_at) {
    context.log.info(`Found closed onboarding; ignore onboarding`);
    return false;
  }

  return true;
}
