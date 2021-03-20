import { Context, ProbotOctokit } from "probot";
import { URL } from "url";

import { Git, clone } from "./git";

async function getAccessToken({
  octokit,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
}): Promise<string> {
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

async function getCredentials({
  octokit,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
}): Promise<{
  name: string;
  login: string;
  email: string;
}> {
  const { data: authenticated } = await octokit.apps.getAuthenticated();

  const token = await getAccessToken({
    octokit,
  });
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

export async function getFile({
  octokit,
  repo,
  branch,
  path,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  branch: string;
  path: string;
}): Promise<string> {
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

export async function getPullRequestCommits({
  octokit,
  repo,
  number,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  number: number;
}): Promise<string[]> {
  return await octokit.paginate(
    octokit.pulls.listCommits,
    repo({
      pull_number: number,
    }),
    ({ data: commits }) => commits.map((commit) => commit.sha)
  );
}

export async function getPullRequestFiles({
  octokit,
  repo,
  number,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  number: number;
}): Promise<string[]> {
  return await octokit.paginate(
    octokit.pulls.listFiles,
    repo({
      pull_number: number,
    }),
    ({ data: files }) => files.map((file) => file.filename)
  );
}

export async function createPullRequest({
  octokit,
  repo,
  branch,
  title,
  body,
  basePullRequest: { base },
  label,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  branch: string;
  title: string;
  body?: string;
  basePullRequest: {
    base: string;
    head: string;
    number: number;
  };
  label?: string;
}): Promise<number> {
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

export async function cloneRepo({
  octokit,
  repo,
  branch,
  depth = 1,
}: {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  branch: string;
  depth?: number;
}): Promise<Git> {
  const {
    data: { clone_url },
  } = await octokit.repos.get(repo({}));

  const url = new URL(clone_url);
  url.username = "x-access-token";
  url.password = await getAccessToken({
    octokit,
  });

  const { name: user, email } = await getCredentials({
    octokit,
  });

  const git = await clone({
    url,
    user,
    email,
    sha: branch,
    depth,
  });

  return git;
}
