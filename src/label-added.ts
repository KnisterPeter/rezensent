import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { createBotContext } from "./bot-context";
import { getPatternsByTeam, getTeams } from "./codeowners";
import { getConfig } from "./config";
import {
  cloneRepo,
  createPullRequest,
  getFile,
  getPullRequestCommits,
  getPullRequestFiles,
} from "./github";

export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { name: label } = context.payload.label ?? {};
  const {
    number,
    base: { ref: base },
    head: { ref: head, sha: headSha },
    title,
  } = context.payload.pull_request;

  const configuration = await getConfig(context, head);

  if (label !== configuration.manageReviewLabel) {
    context.log.debug(`[PR-${number}] ignoring label`);
    return;
  }

  context.log.debug(`[PR-${number}] Manage Review label added`);

  const botContext = createBotContext(context);

  const codeowners = await getFile(botContext, {
    branch: head,
    path: ".github/CODEOWNERS",
  });

  const changedFiles = await getPullRequestFiles(botContext, {
    number,
  });

  // todo: implement policy-bot mapper
  const patterns = getTeams({
    file: codeowners,
  }).reduce((map, team) => {
    map.set(team, getPatternsByTeam({ file: codeowners, team }));
    return map;
  }, new Map<string, string[]>());

  const changedFilesByTeam = changedFiles.reduce((map, file) => {
    for (const [team, pattern] of patterns.entries()) {
      if (pattern.some((p) => new RegExp(p).test(file))) {
        let files = map.get(team);
        if (!files) {
          files = [];
          map.set(team, files);
        }
        files.push(file);
      }
    }
    return map;
  }, new Map<string, string[]>());

  if (changedFilesByTeam.size === 1) {
    context.log.debug(
      `[PR-${number}] ignoring, because it contains only changes for one team`
    );
    return;
  }

  context.log.debug(
    Object.fromEntries(changedFilesByTeam.entries()),
    `[PR-${number}] files changed by team`
  );

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: headSha,
      state: "pending",
      context: "rezensent",
      description: "blocking while in review",
    })
  );

  const commits = await getPullRequestCommits(botContext, {
    number,
  });

  context.log.debug({ commits }, `[PR-${number}] commits`);

  const git = await cloneRepo(botContext, {
    branch: headSha,
    depth: commits.length + 1,
  });
  try {
    context.log.debug(`[PR-${number}] resetting branch`);
    const startPoint = await git.resetCommits(
      `${commits[commits.length - 1]}^`
    );

    for (const [team, files] of changedFilesByTeam) {
      context.log.debug({ team, files }, `[PR-${number}] preparing changes`);
      const branch = `${head}-${team}`;

      await git.addToNewBranch(botContext, {
        branch,
        startPoint,
        files,
      });
      await git.commitAndPush(botContext, {
        message: `Changes from #${number} for ${team}`,
        branch,
      });

      const teamPullRequestNumber = await createPullRequest(botContext, {
        branch,
        title: `${title} - ${team}`,
        body: `Splitted changes for ${team} from #${number}`,
        basePullRequest: {
          base,
          head,
          number,
        },
        label: configuration.teamReviewLabel,
      });
      context.log.debug(
        `[PR-${number}] created team pull request PR-${teamPullRequestNumber}`
      );
    }
  } finally {
    await git.close();
  }

  context.log.debug(`[PR-${number}] done preparing`);
}
