import type { WebhookEvent } from "@octokit/webhooks";
import { promises as fsp } from "fs";
import { load } from "js-yaml";
import { dirname, join } from "path";
import type { Context } from "probot";
import { getConfig, mapYamlToConfiguration } from "./config";
import { getCredentials, withGit } from "./github/clone";
import { setCommitStatus } from "./github/commit-status";
import { getFile } from "./github/files";
import { getPullRequests } from "./github/get";

const title = "Configure rezensent";
const onboardingBranch = "rezensent/setup";
const configFile = ".github/rezensent.yml";
const codeownersFile = ".github/CODEOWNERS";

export async function setupBot(
  context: Omit<Context<any>, keyof WebhookEvent<any>>
): Promise<boolean> {
  const {
    data: { owner, default_branch },
  } = await context.octokit.repos.get(context.repo({}));

  try {
    const configuration = await getConfig(context, default_branch);
    await getFile(context, {
      branch: default_branch,
      path: codeownersFile,
    });

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
    if (!owner) {
      context.log.error(
        "[Onboarding] unable to determine repository owner; continue without onboarding"
      );
      return true;
    }
    try {
      await runOnboarding(context, owner.login, default_branch);
    } catch (err) {
      context.log.error(
        err,
        "[Onboarding] failed; continue without onboarding"
      );
      return true;
    }
  }
  return false;
}

async function runOnboarding(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  owner: string,
  branch: string
): Promise<void> {
  if (!(await requireOnboarding(context, owner, branch))) {
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

    let hasConfig: boolean;
    try {
      await fsp.stat(join(git.directory, configFile));
      hasConfig = true;
    } catch {
      hasConfig = false;
    }

    let hasCodeowners;
    try {
      await fsp.stat(join(git.directory, codeownersFile));
      hasCodeowners = true;
    } catch {
      hasCodeowners = false;
    }

    if (!hasConfig) {
      const configPath = join(git.directory, configFile);
      await fsp.mkdir(dirname(configPath), {
        recursive: true,
      });

      if (await git.hasRemoteBranch(onboardingBranch)) {
        await git.checkout(onboardingBranch);
        await fsp.writeFile(configPath, configTemplate);
        await git.addFiles([configFile]);
      } else {
        await fsp.writeFile(configPath, configTemplate);

        await git.addToNewBranch({
          branch: onboardingBranch,
          files: [configFile],
        });
      }
      await git.commitAndPush({
        branch: onboardingBranch,
        message: "chore: configure rezensent",
      });
    }

    let body = onboardingTemplate
      .replace(
        // https://regex101.com/r/J2aqvf/1
        /^\s*{{\slabels\s}}\n/gms,
        [
          `  - **${configuration.manageReviewLabel}** as label for managed pull requests`,
          `  - **${configuration.teamReviewLabel}** as label for team review requests`,
        ].join("\n")
      )
      .replace(
        /^\s*{{\snoCodeownersFound\s}}\n/gms,
        hasCodeowners
          ? ""
          : `- No **CODEOWNERS** found in \`${codeownersFile}\`.  \n  This is required to split pull requests by teams. (see: [GitHub documentation](https://docs.github.com/en/github/creating-cloning-and-archiving-repositories/about-code-owners))`
      );

    let pr = await getOnboardingPullRequest(context, owner, branch);
    if (pr?.state === "open") {
      await context.octokit.pulls.update(
        context.repo({
          pull_number: pr.number,
          body,
        })
      );

      context.log.info(`Updated onboarding pr ${pr.number}`);
    } else {
      const { data } = await context.octokit.pulls.create(
        context.repo({
          base: branch,
          head: onboardingBranch,
          title,
          body,
        })
      );
      pr = {
        number: data.number,
        head: data.head,
        user: data.user,
        state: "open",
        closed: false,
        merged: false,
      };

      context.log.info(`Created onboarding pr ${pr.number}`);
    }

    if (hasCodeowners) {
      await setCommitStatus(
        context,
        pr.head.sha,
        "success",
        "Ready to merge onboarding"
      );
    } else {
      await setCommitStatus(
        context,
        pr.head.sha,
        "error",
        "CODEOWNERS missing"
      );
    }
  });
}

async function requireOnboarding(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  owner: string,
  branch: string
): Promise<boolean> {
  const pr = await getOnboardingPullRequest(context, owner, branch);
  if (!pr) {
    return true;
  }

  if (pr.closed && !pr.merged) {
    context.log.info(
      `Found closed (but unmerged) onboarding; ignore onboarding`
    );
    return false;
  }

  try {
    await getFile(context, {
      branch,
      path: codeownersFile,
    });
  } catch {
    context.log.info(`No codeowners found; require onboarding`);
  }

  return true;
}

async function getOnboardingPullRequest(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  owner: string,
  branch: string
): Promise<
  | {
      number: number;
      head: {
        sha: string;
      };
      user: {
        login: string;
      } | null;
      state: "open" | "closed";
      closed: boolean;
      merged: boolean;
    }
  | undefined
> {
  const user = await getCredentials(context.octokit);

  const pullRequests = await getPullRequests(context, {
    params: {
      base: branch,
      head: `${owner}:${onboardingBranch}`,
      per_page: 100,
      state: "all",
    },
  });

  const pr = pullRequests.find(
    (pullRequest) =>
      pullRequest.title === title && pullRequest.user?.login === user.login
  );

  context.log.debug({ onboarding: pr?.number }, "Onboarding pull request");

  return pr
    ? {
        number: pr.number,
        head: pr.head,
        state: pr.state === "open" ? "open" : "closed",
        user: pr.user
          ? {
              login: pr.user.login,
            }
          : null,
        closed: Boolean(pr.closed_at),
        merged: Boolean(pr.merged_at),
      }
    : undefined;
}
