import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getPatternsByTeam, getTeams } from "./codeowners";
import * as config from "./config";
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

  const configuration = await config.get(context, head);

  if (label !== configuration.label) {
    context.log.debug(`Ignoring label on PR ${number}`);
    return;
  }

  const repo = context.repo.bind(context);

  const codeowners = await getFile({
    octokit: context.octokit,
    repo,
    branch: head,
    path: ".github/CODEOWNERS",
  });

  const changedFiles = await getPullRequestFiles({
    octokit: context.octokit,
    repo,
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
      `Ignoring PR ${number}, because it contains only changes for one team`
    );
    return;
  }

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: headSha,
      state: "pending",
      context: "rezensent",
      description: "blocking while in review",
    })
  );

  const commits = await getPullRequestCommits({
    octokit: context.octokit,
    repo,
    number,
  });

  const git = await cloneRepo({
    octokit: context.octokit,
    repo,
    branch: headSha,
    depth: commits.length + 1,
  });
  try {
    const startPoint = await git.resetCommits(
      `${commits[commits.length - 1]}^`
    );

    for (const [team, files] of changedFilesByTeam) {
      const branch = `${head}-${team}`;

      await git.addToNewBranch({
        branch,
        startPoint,
        files,
      });
      await git.commitAndPush({
        message: `Changes from #${number} for ${team}`,
        branch,
      });

      await createPullRequest({
        octokit: context.octokit,
        repo,
        branch,
        title: `${title} - ${team}`,
        body: `Splitted changes for ${team} from #${number}`,
        basePullRequest: {
          base,
          head,
          number,
        },
      });
    }
  } finally {
    await git.close();
  }
}
