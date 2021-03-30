import { Context, ProbotOctokit } from "probot";
import { URL } from "url";

import { clone, Git } from "../git";

async function getAccessToken(octokit: Context["octokit"]): Promise<string> {
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
  octokit: Context["octokit"]
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

export async function withGit(
  context: Context,
  {
    branch,
    depth = 1,
  }: {
    branch: string;
    depth?: number;
  },
  task: (git: Git) => Promise<void>
): Promise<void> {
  const {
    data: { clone_url },
  } = await context.octokit.repos.get(context.repo({}));

  const url = new URL(clone_url);
  url.username = "x-access-token";
  url.password = await getAccessToken(context.octokit);

  const { name: user, email } = await getCredentials(context.octokit);

  const git = await clone({
    url,
    user,
    email,
    sha: branch,
    depth,
  });

  try {
    await task(git);
  } finally {
    await git.close();
  }
}
