import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { Configuration, getConfig } from "../../config";
import { Git } from "../../git";
import { withGit } from "../../github/clone";
import { getPullRequestCommits } from "../../github/commits";
import { createPullRequest } from "../../github/create";
import { getChangedFilesPerTeam } from "../../github/files";
import { getFilePatternMapPerTeam } from "../../ownership/codeowners";
import { match } from "../../pr/matcher";

/**
 * Called when a label is added to a pull request.
 */
export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const {
    number,
    head: { ref: head },
  } = context.payload.pull_request;

  const configuration = await getConfig(context, head);

  await match(context, number, {
    async managed(managed) {
      context.log.debug(`[PR-${managed.number}] Manage Review label added`);

      const patterns = await getFilePatternMapPerTeam(context, {
        branch: managed.head.ref,
      });

      const changedFilesByTeam = await getChangedFilesPerTeam(context, {
        number: managed.number,
        patterns,
      });

      context.log.debug(
        Object.fromEntries(changedFilesByTeam.entries()),
        `[PR-${managed.number}] files changed by team`
      );

      await context.octokit.repos.createCommitStatus(
        context.repo({
          sha: managed.head.sha,
          context: "rezensent",
          description: "blocking while in review",
          state: "pending",
        })
      );

      await createTeamPullRequests(context, {
        changedFilesByTeam,
        configuration,
        number: managed.number,
      });

      context.log.debug(`[PR-${managed.number}] done preparing`);
    },
  });
}

async function createPullRequestForTeam(
  context: Context,
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
  context: Context,
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

  await withGit(
    context,
    {
      branch: pr.head.ref,
      depth: commits.length + 1,
    },
    async (git) => {
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
    }
  );
}
