import { Endpoints } from "@octokit/types";
import { ProbotOctokit } from "probot";
import { URL } from "url";
import { promisify } from "util";

import { BotContext } from "./bot-context";
import { getPatternsByTeam, getTeams } from "./codeowners";
import { Git, clone } from "./git";

export type PullRequest = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][number];

const wait = promisify(setTimeout);

async function getAccessToken(octokit: BotContext["octokit"]): Promise<string> {
  const { data: installations } = await octokit.apps.listInstallations();

  if (!installations[0]) {
    throw new Error("No installation found");
  }

  const {
    data: accessToken,
  } = await octokit.apps.createInstallationAccessToken({
    installation_id: installations[0].id,
  });

  return accessToken.token;
}

async function getCredentials(
  octokit: BotContext["octokit"]
): Promise<{
  name: string;
  login: string;
  email: string;
}> {
  const { data: authenticated } = await octokit.apps.getAuthenticated();

  const token = await getAccessToken(octokit);
  const authenticatedOctokit = new ProbotOctokit({
    auth: { token },
  });
  const { data: user } = await authenticatedOctokit.users.getByUsername({
    username: `${authenticated.slug}[bot]`,
  });

  return {
    name: authenticated.name,
    login: user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
  };
}

export async function deleteBranch(
  { octokit, repo }: BotContext,
  branch: string
): Promise<void> {
  await octokit.git.deleteRef(
    repo({
      ref: `heads/${branch}`,
    })
  );
}

export async function getFile(
  { octokit, repo }: BotContext,
  {
    branch,
    path,
  }: {
    branch: string;
    path: string;
  }
): Promise<string> {
  const { data } = await octokit.repos.getContent(
    repo({
      ref: branch,
      path: ".github/CODEOWNERS",
    })
  );
  if (typeof data !== "object" || !("content" in data)) {
    throw new Error(`File '${path}' not found`);
  }

  return Buffer.from(data.content, "base64").toString().replace("\\n", "\n");
}

export async function getPullRequestCommits(
  { octokit, repo }: BotContext,
  {
    number,
  }: {
    number: number;
  }
): Promise<string[]> {
  return await octokit.paginate(
    octokit.pulls.listCommits,
    repo({
      pull_number: number,
    }),
    ({ data: commits }) => commits.map((commit) => commit.sha)
  );
}

export async function getPullRequestFiles(
  { octokit, repo }: BotContext,
  {
    number,
  }: {
    number: number;
  }
): Promise<string[]> {
  return await octokit.paginate(
    octokit.pulls.listFiles,
    repo({
      pull_number: number,
    }),
    ({ data: files }) => files.map((file) => file.filename)
  );
}

export async function createPullRequest(
  { octokit, repo }: BotContext,
  {
    branch,
    title,
    body,
    managedPullRequest: { base },
    label,
  }: {
    branch: string;
    title: string;
    body?: string;
    managedPullRequest: {
      base: string;
      head: string;
      number: number;
    };
    label?: string;
  }
): Promise<number> {
  const {
    data: { number },
  } = await octokit.pulls.create(
    repo({
      base,
      head: branch,
      title,
      body,
    })
  );

  if (label) {
    await octokit.issues.addLabels(
      repo({
        issue_number: number,
        labels: [label],
      })
    );
  }

  return number;
}

export async function closePullRequest(
  { octokit, repo }: BotContext,
  {
    number,
  }: {
    number: number;
  }
): Promise<void> {
  await octokit.pulls.update(
    repo({
      pull_number: number,
      state: "closed",
    })
  );
}

export async function cloneRepo(
  { octokit, repo }: BotContext,
  {
    branch,
    depth = 1,
  }: {
    branch: string;
    depth?: number;
  }
): Promise<Git> {
  const {
    data: { clone_url },
  } = await octokit.repos.get(repo({}));

  const url = new URL(clone_url);
  url.username = "x-access-token";
  url.password = await getAccessToken(octokit);

  const { name: user, email } = await getCredentials(octokit);

  const git = await clone({
    url,
    user,
    email,
    sha: branch,
    depth,
  });

  return git;
}

export async function getPullRequests(
  { octokit, repo }: BotContext,
  {
    params,
    filters,
  }: {
    params?: Omit<
      Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"],
      "repo" | "owner"
    >;
    filters?: {
      label?: string | RegExp;
    };
  }
): Promise<PullRequest[]> {
  let pullRequests = await octokit.paginate(
    octokit.pulls.list,
    repo({ per_page: 100, ...params })
  );

  if (filters) {
    if (filters.label) {
      const test = filters.label;
      pullRequests = pullRequests.filter((pullRequest) => {
        const labels = pullRequest.labels
          .map((label) => label.name)
          .filter((label): label is string => Boolean(label));
        return typeof test === "string"
          ? labels.includes(test)
          : labels.some((label) => test.test(label));
      });
    }
  }

  return pullRequests;
}

export async function isReferencedPullRequest(
  { octokit, repo }: BotContext,
  {
    number,
    reference,
  }: {
    number: number;
    reference: number;
  }
): Promise<boolean> {
  const items = await octokit.paginate(
    octokit.issues.listEventsForTimeline,
    repo({
      mediaType: {
        previews: ["mockingbird"],
      },
      issue_number: number,
      per_page: 100,
    })
  );

  const crossReferences = items.filter(
    (item) => item.event === "cross-referenced"
  );

  const issues = crossReferences.filter(
    (item) => (item as any).source.type === "issue"
  );

  return issues.some((item) => (item as any).source.issue.number === reference);
}

export async function waitForPullRequestUpdate(
  { octokit, repo }: BotContext,
  {
    pullRequest,
  }: {
    pullRequest: PullRequest;
  }
): Promise<void> {
  let n = 0;
  while (true) {
    const { data: updatedPullRequest } = await octokit.pulls.get(
      repo({ pull_number: pullRequest.number })
    );

    if (pullRequest.base.sha !== updatedPullRequest.base.sha) {
      break;
    }

    await wait(4000);

    // give up if we need to wait for too long
    n++;
    if (n >= 10) {
      break;
    }
  }
}

export async function getFilePatternMapPerTeam(
  context: BotContext,
  { branch }: { branch: string }
): Promise<Map<string, string[]>> {
  const codeowners = await getFile(context, {
    branch,
    path: ".github/CODEOWNERS",
  });

  // todo: implement policy-bot mapper
  const patterns = getTeams({
    file: codeowners,
  }).reduce((map, team) => {
    map.set(team, getPatternsByTeam({ file: codeowners, team }));
    return map;
  }, new Map<string, string[]>());

  return patterns;
}

export async function getChangedFilesPerTeam(
  context: BotContext,
  { number, patterns }: { number: number; patterns: Map<string, string[]> }
): Promise<Map<string, string[]>> {
  const changedFiles = await getPullRequestFiles(context, {
    number,
  });

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

  return changedFilesByTeam;
}
