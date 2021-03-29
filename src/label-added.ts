import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { BotContext, createBotContext } from "./bot-context";
import { Configuration, getConfig } from "./config";
import { Git } from "./git";
import {
  cloneRepo,
  createPullRequest,
  getChangedFilesPerTeam,
  getFilePatternMapPerTeam,
  getPullRequestCommits,
} from "./github";
import { isManagedPullRequest } from "./managed-pull-request";

/**
 * Called when a label is added to a pull request.
 */
export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head, sha: headSha },
  } = context.payload.pull_request;

  const botContext = createBotContext(context);
  const configuration = await getConfig(context, head);

  const isManaged = await isManagedPullRequest(botContext, {
    configuration,
    number,
  });
  if (!isManaged) {
    context.log.debug(`[PR-${number}] ignoring label`);
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label added`);

  const patterns = await getFilePatternMapPerTeam(botContext, { branch: head });

  const changedFilesByTeam = await getChangedFilesPerTeam(botContext, {
    number,
    patterns,
  });

  context.log.debug(
    Object.fromEntries(changedFilesByTeam.entries()),
    `[PR-${number}] files changed by team`
  );

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: headSha,
      context: "rezensent",
      description: "blocking while in review",
      state: "pending",
    })
  );

  await createTeamPullRequests(botContext, {
    changedFilesByTeam,
    configuration,
    number,
  });

  context.log.debug(`[PR-${number}] done preparing`);
}

async function createPullRequestForTeam(
  context: BotContext,
  {
    configuration,
    git,
    startPoint,
    number,
    team,
    files,
  }: {
    configuration: Configuration;
    git: Git;
    startPoint: string;
    number: number;
    team: string;
    files: string[];
  }
): Promise<void> {
  const { data: pr } = await context.octokit.pulls.get(
    context.repo({ pull_number: number })
  );

  context.log.debug({ team, files }, `[PR-${number}] preparing changes`);
  const branch = `${pr.head.ref}-${team}`;

  await git.addToNewBranch({
    branch,
    startPoint,
    files,
  });
  await git.commitAndPush({
    message: `Changes from #${number} for ${team}`,
    branch,
  });

  const teamPullRequestNumber = await createPullRequest(context, {
    branch,
    title: `${pr.title} - ${team}`,
    body: `Splitted changes for ${team} from #${number}`,
    managedPullRequest: {
      base: pr.base.ref,
      head: pr.head.ref,
      number,
    },
    label: configuration.teamReviewLabel,
  });
  context.log.debug(
    { team },
    `[PR-${number}] created team pull request PR-${teamPullRequestNumber}`
  );
}

async function createTeamPullRequests(
  context: BotContext,
  {
    changedFilesByTeam,
    configuration,
    number,
  }: {
    changedFilesByTeam: Map<string, string[]>;
    configuration: Configuration;
    number: number;
  }
): Promise<void> {
  const { data: pr } = await context.octokit.pulls.get(
    context.repo({ pull_number: number })
  );

  const commits = await getPullRequestCommits(context, {
    number,
  });
  const firstCommit = commits[commits.length - 1];

  context.log.debug({ commits }, `[PR-${number}] commits`);

  const git = await cloneRepo(context, {
    branch: pr.head.ref,
    depth: commits.length + 1,
  });
  try {
    context.log.debug(`[PR-${number}] resetting branch`);
    const startPoint = await git.resetCommits(`${firstCommit}^`);

    for (const [team, files] of changedFilesByTeam) {
      await createPullRequestForTeam(context, {
        configuration,
        git,
        startPoint,
        team,
        files,
        number,
      });
    }
  } finally {
    await git.close();
  }
}
