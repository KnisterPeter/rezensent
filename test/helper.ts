import type { Endpoints } from "@octokit/types";
import chalk from "chalk";
import { config as dotEnvConfig } from "dotenv";
import type EventSource from "eventsource";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ProbotOctokit } from "probot";
import Git, { SimpleGit } from "simple-git";
import sliceAnsi from "slice-ansi";
import SmeeClient from "smee-client";
import { URL } from "url";
import { promisify } from "util";
import { Server, startServer } from "../src/node";

const wait = promisify(setTimeout);
export const enum Seconds {
  one = 1000 * 1,
  two = 1000 * 2,
  ten = 1000 * 10,
  thirty = 1000 * 30,
  sixty = 1000 * 60,
}
export const enum Minutes {
  one = Seconds.sixty,
  two = Seconds.sixty * 2,
  ten = Seconds.sixty * 10,
  fifteen = Seconds.sixty * 15,
  thirty = Seconds.sixty * 30,
  sixty = Seconds.sixty * 60,
}
export const titlePattern = "[%t] %s";
export const branchPattern = "%t-%s";
export const namePattern = "%t-%s";

export type Awaited<PromiseType> = PromiseType extends Promise<infer Value>
  ? Value
  : never;

beforeAll(() => {
  dotEnvConfig();
});

let server: Server;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.stop();
});

let smee: EventSource;

afterAll(() => {
  smee?.close();
});

export function idGen(n: number): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  let str = "";
  for (let i = 0; i < n; i++) {
    str += chars[Math.round(Math.random() * (chars.length - 1))];
  }
  return str;
}

function has<K extends string>(o: object, key: K): o is Record<K, unknown> {
  return key in o;
}

function get<ReturnType = unknown>(input: unknown, path: string): ReturnType {
  const parts = path.split(".");
  return parts.reduce((last, part) => {
    return (last as any)[part];
  }, input) as ReturnType;
}

class ExtendedSmeeClient extends SmeeClient {
  #testId: string;

  constructor({
    testId,
    ...options
  }: ConstructorParameters<typeof SmeeClient>[0] & { testId: string }) {
    super(options);
    this.#testId = testId;
  }

  onmessage(msg: unknown) {
    if (
      typeof msg === "object" &&
      msg !== null &&
      has(msg, "data") &&
      typeof msg.data === "string"
    ) {
      const data = JSON.parse(msg.data);
      if (has(data, "x-github-event")) {
        switch (data["x-github-event"]) {
          case "installation_repositories":
            try {
              const action = get<string>(data, "body.action");
              const key =
                action === "added"
                  ? "repositories_added"
                  : "repositories_removed";
              const name = get<string>(data, `body.${key}.0.name`);
              if (name === testify(name, this.#testId, namePattern)) {
                return super.onmessage(msg);
              }
              // detected concurrent tests, skip
              return;
            } catch {
              // ignore and throw below
            }
            break;
          case "pull_request":
            try {
              const title = get<string>(data, "body.pull_request.title");
              if (title === testify(title, this.#testId, titlePattern)) {
                return super.onmessage(msg);
              }
              // detected concurrent tests, skip
              return;
            } catch {
              // ignore and throw below
            }
            break;
          case "check_suite":
            try {
              const head = get<string>(data, "body.check_suite.head_branch");
              if (head === testify(head, this.#testId, branchPattern)) {
                return super.onmessage(msg);
              }
              // detected concurrent tests, skip
              return;
            } catch {
              // ignore and throw below
            }
            break;
          case "status":
            try {
              const branch = get<string>(data, "body.branches.0.name");
              if (branch === testify(branch, this.#testId, branchPattern)) {
                return super.onmessage(msg);
              }
              // detected concurrent tests, skip
              return;
            } catch {
              // ignore and throw below
            }
            break;
          case "issue_comment":
            try {
              const title = get<string>(data, "body.issue.title");
              if (title === testify(title, this.#testId, titlePattern)) {
                return super.onmessage(msg);
              }
              // detected concurrent tests, skip
              return;
            } catch {
              // ignore and throw below
            }
            break;
        }

        throw new Error(`Unknown webhook message: '${data["x-github-event"]}'`);
      }
    }

    throw new Error("Received invalid webhook message");
  }
}

export function createEventSource(testId: string): EventSource {
  if (!smee) {
    if (!process.env["WEBHOOK_PROXY_URL"]) {
      throw new Error("Required 'WEBHOOK_PROXY_URL' missing");
    }

    smee = new ExtendedSmeeClient({
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
      source: process.env["WEBHOOK_PROXY_URL"],
      target: `http://localhost:${server.port}`,
      testId,
    }).start();
  }
  return smee;
}

function createJwtOctokit() {
  if (!process.env["APP_ID"] || !process.env["PRIVATE_KEY"]) {
    throw new Error("Required 'APP_ID' or 'PRIVATE_KEY' missing");
  }

  const appOctokit = new ProbotOctokit({
    auth: {
      appId: Number(process.env["APP_ID"]),
      privateKey: process.env["PRIVATE_KEY"],
    },
  });

  return appOctokit;
}

async function getAccessToken(): Promise<string> {
  const appOctokit = createJwtOctokit();

  const { data: installations } = await appOctokit.apps.listInstallations();

  if (!installations[0]) {
    throw new Error("No installation found");
  }

  const {
    data: accessToken,
  } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: installations[0].id,
  });

  return accessToken.token;
}

export async function createAppOctokit(): Promise<
  InstanceType<typeof ProbotOctokit>
> {
  const token = await getAccessToken();

  return new ProbotOctokit({
    auth: { token },
  });
}

export function createUserOctokit(): InstanceType<typeof ProbotOctokit> {
  const token = process.env["USER_TOKEN"];
  if (!token) {
    throw new Error("No USER_TOKEN provided");
  }

  return new ProbotOctokit({
    auth: { token },
  });
}

export interface GithubApiContext {
  owner: string;
  repo<T>(object: T): { owner: string; repo: string } & T;
}

function testify(str: string, testId: string, test: string): string {
  const pattern = test
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/%s/g, ".*?")
    .replace(/%t/g, testId);
  const regexp = new RegExp(pattern);

  if (str.startsWith("origin/")) {
    return `origin/${testify(str.substr("origin/".length), testId, test)}`;
  }
  return regexp.test(str) ? str : test.replace("%s", str).replace("%t", testId);
}

export type CreatePullRequestParams = Omit<
  Endpoints["POST /repos/{owner}/{repo}/pulls"]["parameters"],
  "owner" | "repo"
>;
export type ListPullRequestParams = Omit<
  Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"],
  "owner" | "repo"
> & {
  user: string;
  assignee: string;
  labels: string[];
};
export type ListPullRequestResponse = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][number];
export type CreateLabelParams = Omit<
  Endpoints["POST /repos/{owner}/{repo}/labels"]["parameters"],
  "owner" | "repo"
>;
export type GetPullRequestResponse = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];

export type CommitStatusesForReferenceParams = Omit<
  Endpoints["GET /repos/{owner}/{repo}/commits/{ref}/statuses"]["parameters"],
  "owner" | "repo"
>;
export type CommitStatusesForReferenceResponse = Endpoints["GET /repos/{owner}/{repo}/commits/{ref}/statuses"]["response"]["data"][number];

export type UserRepositoryParams = Endpoints["POST /user/repos"]["parameters"];
export type UserRepositoryResponse = Endpoints["POST /user/repos"]["response"];

export async function waitFor<Result>(
  test: () => Promise<Result | undefined>,
  timeout: number
): Promise<Result> {
  const start = Date.now();

  let result = await test();
  while (result === undefined) {
    if (start + timeout < Date.now()) {
      throw new Error("Timeout");
    }
    await wait(Seconds.two);
    result = await test();
  }

  return result;
}

export type AppOctokit = Awaited<ReturnType<typeof createAppOctokit>>;
export type UserOctokit = ReturnType<typeof createUserOctokit>;

export interface User {
  name: string;
  login: string;
  email: string;
  token: string;
}

export interface GithubApi {
  octokit: InstanceType<typeof ProbotOctokit>;
  context: GithubApiContext;

  getUser(): Promise<User>;

  createLabel(params: Partial<CreateLabelParams>): Promise<string>;
  deleteLabel(name: string): Promise<void>;
  deleteLabelAfterTest(name: string): void;
  addLabel(number: number, name: string): Promise<void>;
  removeLabel(number: number, name: string): Promise<void>;

  createPullRequest(params: Partial<CreatePullRequestParams>): Promise<number>;
  closePullRequest(number: number): Promise<void>;
  closePullRequestAfterTest(number: number): void;
  mergePullRequest(number: number): Promise<void>;
  getPullRequest(number: number): Promise<GetPullRequestResponse>;
  getPullRequestFiles(number: number): Promise<string[]>;

  waitForPullRequest(
    params: Partial<ListPullRequestParams>,
    timeout?: number
  ): Promise<number>;
  waitForPullRequestBaseToBeUpdated(
    number: number,
    sha: string,
    timeout?: number
  ): Promise<void>;
  waitForPullRequestHeadToBeUpdated(
    number: number,
    sha: string,
    timeout?: number
  ): Promise<void>;

  waitForCommitStatus(
    params: CommitStatusesForReferenceParams,
    filter: Partial<CommitStatusesForReferenceResponse>,
    timeout?: number
  ): Promise<void>;
}

export type Task = () => Promise<void>;

export type TestRunner = {
  testId: string;
  log: typeof console["log"];
  logStep(stepName: string): void;
  cleanupTasks: Task[];
  skipCleanup(): void;

  github: GithubApi;
  createUserGithub(repo: string): Promise<GithubApi>;

  gitClone(
    api?: GithubApi
  ): Promise<{
    directory: string;
    simpleGit: SimpleGit;
    git: {
      fetch(): Promise<void>;
      getSha(name: string): Promise<string>;

      hasBranch(name: string): Promise<boolean>;
      createBranch(name: string): Promise<string>;
      deleteBranch(name: string): Promise<void>;
      deleteBranchAfterTest(name: string): void;
      waitForBranchToBeUpdated(
        name: string,
        sha: string,
        timeout?: number
      ): Promise<string>;
      waitForBranchToBeDeleted(name: string, timeout?: number): Promise<void>;

      writeFiles(files: { [path: string]: string }): Promise<void>;

      push(branch: string): Promise<void>;
      addAndCommitChanges(message: string): Promise<void>;
      addAndPushAllChanges(branch: string, message: string): Promise<void>;
    };
  }>;
};

export interface OctokitTaskContext {
  octokit: AppOctokit;
  context: GithubApiContext;
  testId: string;
  log: typeof console["log"];
}

export async function createLabel(
  { octokit, context, testId, log }: OctokitTaskContext,
  { name = "label", description, color }: Partial<CreateLabelParams>
): Promise<string> {
  const {
    data: { name: labelName },
  } = await octokit.issues.createLabel(
    context.repo({
      name: testify(name, testId, titlePattern),
      description,
      color,
    })
  );

  log(`Created label '${labelName}'`);
  return labelName;
}

export async function deleteLabel(
  { octokit, context, testId, log }: OctokitTaskContext,
  name: string
): Promise<void> {
  log(`Delete label ${name}`);

  await octokit.issues.deleteLabel(
    context.repo({
      name: testify(name, testId, titlePattern),
    })
  );
}

export async function addLabel(
  { octokit, context, testId, log }: OctokitTaskContext,
  number: number,
  name: string
): Promise<void> {
  log(`Add label to pull request [pr=${number}, label=${name}]`);

  await octokit.issues.addLabels(
    context.repo({
      issue_number: number,
      labels: [testify(name, testId, titlePattern)],
    })
  );
}

export async function removeLabel(
  { octokit, context, testId, log }: OctokitTaskContext,
  number: number,
  name: string
): Promise<void> {
  log(`Remove label from pull request [pr=${number}, label=${name}]`);

  await octokit.issues.removeLabel(
    context.repo({
      issue_number: number,
      name: testify(name, testId, titlePattern),
    })
  );
}

export async function createPullRequest(
  { octokit, context, testId, log }: OctokitTaskContext,
  {
    base = "main",
    head = "pull-request",
    title = "Title",
    body = undefined,
    draft = false,
  }: Partial<CreatePullRequestParams>
): Promise<number> {
  const {
    data: { number },
  } = await octokit.pulls.create(
    context.repo({
      base: testify(base, testId, branchPattern),
      head: testify(head, testId, branchPattern),
      title: testify(title, testId, titlePattern),
      body,
      draft,
    })
  );

  log(`Created pull request [number=${number}]`);
  return number;
}

export async function listPullRequests(
  { octokit, context, testId, log }: OctokitTaskContext,
  {
    base,
    direction,
    head,
    sort,
    state,
    user,
    assignee,
    labels,
  }: Partial<ListPullRequestParams>
): Promise<ListPullRequestResponse[]> {
  log(`List pull requests`);

  let list = await octokit.paginate(
    octokit.pulls.list,
    context.repo({
      base: base ? testify(base, testId, branchPattern) : undefined,
      head: head
        ? `${context.owner}:${testify(head, testId, branchPattern)}`
        : undefined,
      direction,
      sort,
      state,
    })
  );

  list = list
    .filter((pullRequest) => !user || pullRequest.user?.login === user)
    .filter(
      (pullRequest) => !assignee || pullRequest.assignee?.login === assignee
    )
    .filter(
      (pullRequest) =>
        !labels ||
        pullRequest.labels
          .map((label) => label.name)
          .filter((label): label is string => Boolean(label))
          .every((label) => labels.includes(label))
    );

  return list;
}

export async function closePullRequest(
  { octokit, context, log }: OctokitTaskContext,
  number: number
): Promise<void> {
  log(`Close pull request [number=${number}]`);

  await octokit.pulls.update(
    context.repo({
      pull_number: number,
      state: "closed",
    })
  );
}

export async function mergePullRequest(
  { octokit, context, log }: OctokitTaskContext,
  number: number
): Promise<void> {
  log(`Merge pull request [number=${number}]`);

  await octokit.pulls.merge(
    context.repo({
      pull_number: number,
    })
  );
}

export async function getPullRequest(
  { octokit, context, log }: OctokitTaskContext,
  number: number
): Promise<GetPullRequestResponse> {
  log(`Get pull request [number=${number}]`);

  const { data: pullRequest } = await octokit.pulls.get(
    context.repo({
      pull_number: number,
    })
  );

  return pullRequest;
}

export async function getPullRequestFiles(
  { octokit, context, log }: OctokitTaskContext,
  number: number
): Promise<string[]> {
  log(`Get pull request files [number=${number}]`);

  return await octokit.paginate(
    octokit.pulls.listFiles,
    context.repo({
      pull_number: number,
    }),
    ({ data: files }) => files.map((file) => file.filename)
  );
}

export async function waitForPullRequest(
  { octokit, context, testId, log }: OctokitTaskContext,
  params: Partial<ListPullRequestParams>,
  timeout: number
): Promise<number> {
  log(
    `Wait for pull request [params=${JSON.stringify(params)}, timeout=${
      timeout / 1000
    }s]`
  );

  const pullRequest = await waitFor<ListPullRequestResponse>(async () => {
    const list = await listPullRequests(
      { octokit, context, testId, log: () => undefined },
      params
    );
    return list.length > 0 ? list[0] : undefined;
  }, timeout);

  return pullRequest.number;
}

export async function waitForPullRequestBaseToBeUpdated(
  { octokit, context, log }: OctokitTaskContext,
  number: number,
  sha: string,
  timeout: number
): Promise<void> {
  log(`Wait for pull request base update [timeout=${timeout / 1000}s]`);

  await waitFor(async () => {
    const { data } = await octokit.pulls.get(
      context.repo({ pull_number: number })
    );
    return data.base.sha !== sha ? true : undefined;
  }, timeout);
}

export async function waitForPullRequestHeadToBeUpdated(
  { octokit, context, log }: OctokitTaskContext,
  number: number,
  sha: string,
  timeout: number
): Promise<void> {
  log(`Wait for pull request head update [timeout=${timeout / 1000}s]`);

  await waitFor(async () => {
    const { data } = await octokit.pulls.get(
      context.repo({ pull_number: number })
    );
    return data.head.sha !== sha ? true : undefined;
  }, timeout);
}

export async function waitForCommitStatus(
  { octokit, context, log }: OctokitTaskContext,
  params: CommitStatusesForReferenceParams,
  filter: Partial<CommitStatusesForReferenceResponse>,
  timeout: number
): Promise<void> {
  log(`Wait for commit status [timeout=${timeout / 1000}s]`);

  await waitFor(async () => {
    const { data: statuses } = await octokit.repos.listCommitStatusesForRef(
      context.repo({
        ref: params.ref,
      })
    );

    const contextSeen = new Set<string>();

    const latestStatuses = statuses.filter((status) => {
      const seen = contextSeen.has(status.context);
      contextSeen.add(status.context);
      return !seen;
    });

    const matchingStatus = latestStatuses.filter(
      (status) =>
        (!filter.context || status.context === filter.context) &&
        (!filter.description || status.description === filter.description) &&
        (!filter.state || status.state === filter.state)
    );

    return matchingStatus.length === 0 ? undefined : true;
  }, timeout);
}

export async function getCredentials(octokit: AppOctokit): Promise<User> {
  const appOctokit = createJwtOctokit();

  const { data: authenticated } = await appOctokit.apps.getAuthenticated();
  const { data: user } = await octokit.users.getByUsername({
    username: `${authenticated.slug}[bot]`,
  });

  const token = await getAccessToken();

  return {
    name: authenticated.name,
    login: user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
    token,
  };
}

export async function setupGit(
  github: GithubApi
): Promise<{ git: SimpleGit; directory: string }> {
  const { octokit, context } = github;

  const user = await github.getUser();

  const baseDir = await fsp.mkdtemp(join(tmpdir(), "rezensent"));
  try {
    const git: SimpleGit = Git({ baseDir });

    const {
      data: { clone_url },
    } = await octokit.repos.get(context.repo({}));
    const url = new URL(clone_url);
    url.username = "x-access-token";
    url.password = user.token;

    await git.clone(url.toString(), baseDir);

    await git.addConfig("user.name", user.login);
    await git.addConfig("user.email", user.email);

    return { git, directory: baseDir };
  } catch (e) {
    await fsp.rm(baseDir, { recursive: true, force: true });

    throw e;
  }
}

export interface SimpleGitTaskContext {
  git: SimpleGit;
  testId: string;
  log: typeof console["log"];
}

export async function fetch({ git, log }: SimpleGitTaskContext): Promise<void> {
  log(`Fetch repo`);

  await git.fetch();
}

export async function getSha(
  { git, testId }: SimpleGitTaskContext,
  name: string
): Promise<string> {
  try {
    return await git.revparse([testify(name, testId, branchPattern)]);
  } catch (e) {
    throw new Error(`Failed to get sha for '${name}':\n${e.stack}`);
  }
}

export async function hasBranch(
  { git, testId, log }: SimpleGitTaskContext,
  name: string
): Promise<boolean> {
  log(`Has branch? [name=${name}]`);

  await git.fetch();
  const branches = await git.branch();
  const exists = branches.all.includes(testify(name, testId, branchPattern));

  return exists;
}

export async function createBranch(
  { git, testId, log }: SimpleGitTaskContext,
  name: string
): Promise<string> {
  log(`Crate branch [name=${name}]`);

  const branchName = testify(name, testId, branchPattern);
  await git.checkout(["-b", branchName]);
  return branchName;
}

export async function deleteBranch(
  { git, testId, log }: SimpleGitTaskContext,
  name: string
): Promise<void> {
  log(`Delete branch [name=${name}]`);

  const branchName = testify(name, testId, branchPattern);

  await git.push(["origin", "--delete", branchName]);
}

export async function waitForBranchToBeUpdated(
  { git, testId, log }: SimpleGitTaskContext,
  name: string,
  oldSha: string,
  timeout: number
): Promise<string> {
  log(`Wait for branch update [name=${name}, timeout=${timeout / 1000}s]`);

  const newSha = await waitFor(async () => {
    await git.fetch();
    const sha = await getSha(
      { git, testId, log: () => undefined },
      `origin/${name}`
    );
    return sha === oldSha ? undefined : sha;
  }, timeout);

  return newSha;
}

export async function waitForBranchToBeDeleted(
  { git, testId, log }: SimpleGitTaskContext,
  name: string,
  timeout: number
): Promise<void> {
  log(`Wait for branch deleted [name=${name}, timeout=${timeout / 1000}s]`);

  await waitFor(async () => {
    const exists = await hasBranch({ git, testId, log: () => undefined }, name);
    return exists ? undefined : true;
  }, timeout);
}

export async function writeFiles(
  directory: string,
  files: { [path: string]: string }
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const [path, contents] of Object.entries(files)) {
    tasks.push(
      (async () => {
        const fullPath = join(directory, path);
        await fsp.mkdir(dirname(fullPath), { recursive: true });
        await fsp.writeFile(fullPath, contents);
      })()
    );
  }
  await Promise.all(tasks);
}

export async function pushBranch(
  git: SimpleGit,
  testId: string,
  branch: string
): Promise<void> {
  await git.push(["origin", testify(branch, testId, branchPattern)]);
}

export async function addAndCommitChanges(
  { git }: SimpleGitTaskContext,
  message: string
): Promise<void> {
  await git.add(["."]).commit(message);
}

export async function addAndPushAllChanges(
  git: SimpleGit,
  testId: string,
  branch: string,
  message: string
): Promise<void> {
  await git.add(["."]).commit(message);
  await pushBranch(git, testId, branch);
}

export function setupApp(
  test: (runner: TestRunner) => Promise<void>
): () => Promise<void> {
  return async () => {
    const testId = idGen(5);
    const eventSource = createEventSource(testId);

    const testIntroLine = chalk`══╕ {white.inverse  ${
      expect.getState().currentTestName
    } } ╞═ (${testId}) ══════════════════════════════════════════════════════════════════════════════════════════════════════════`;
    const logs = [sliceAnsi(testIntroLine, 0, 110), `  │`];
    const log: typeof console["log"] = (...args) => {
      if (process.env["LOG_LEVEL"] === "debug") {
        process.stdout.write(chalk`{white.inverse  TEST } ${args.join(" ")}\n`);
      }
      logs.push(chalk`  │ ${args.join(" ")}`);
    };

    try {
      let doCleanup = true;
      const cleanupTasks: Task[] = [];
      const octokit = await createAppOctokit();

      const createGithubApi = (
        octokit: InstanceType<typeof ProbotOctokit>,
        context: GithubApiContext,
        getUser: () => Promise<User>
      ) => {
        const github: TestRunner["github"] = {
          octokit,
          context,

          getUser,

          createLabel: async (params) => {
            const label = await createLabel(
              { octokit, context, testId, log },
              params
            );
            github.deleteLabelAfterTest(label);
            return label;
          },
          deleteLabel: (name) =>
            deleteLabel({ octokit, context, testId, log }, name),
          deleteLabelAfterTest: (name) =>
            cleanupTasks.push(() =>
              deleteLabel(
                { octokit, context, testId, log: () => undefined },
                name
              )
            ),
          addLabel: (number, name) =>
            addLabel({ octokit, context, testId, log }, number, name),
          removeLabel: (number, name) =>
            removeLabel({ octokit, context, testId, log }, number, name),

          createPullRequest: async (params) => {
            const number = await createPullRequest(
              { octokit, context, testId, log },
              params
            );
            github.closePullRequestAfterTest(number);
            return number;
          },
          closePullRequest: (number) =>
            closePullRequest({ octokit, context, testId, log }, number),
          closePullRequestAfterTest: (number) =>
            cleanupTasks.push(() =>
              closePullRequest(
                { octokit, context, testId, log: () => undefined },
                number
              )
            ),
          mergePullRequest: (number) =>
            mergePullRequest({ octokit, context, testId, log }, number),
          getPullRequest: (number) =>
            getPullRequest({ octokit, context, testId, log }, number),
          getPullRequestFiles: (number) =>
            getPullRequestFiles({ octokit, context, testId, log }, number),

          waitForPullRequest: async (params, timeout = Seconds.sixty) =>
            waitForPullRequest(
              { octokit, context, testId, log },
              params,
              timeout
            ),
          waitForPullRequestBaseToBeUpdated: async (
            number,
            sha,
            timeout = Seconds.sixty
          ) =>
            waitForPullRequestBaseToBeUpdated(
              { octokit, context, testId, log },
              number,
              sha,
              timeout
            ),
          waitForPullRequestHeadToBeUpdated: async (
            number,
            sha,
            timeout = Seconds.sixty
          ) =>
            waitForPullRequestHeadToBeUpdated(
              { octokit, context, testId, log },
              number,
              sha,
              timeout
            ),

          waitForCommitStatus: (params, filter, timeout = Seconds.sixty) =>
            waitForCommitStatus(
              { octokit, context, testId, log },
              params,
              filter,
              timeout
            ),
        };

        return github;
      };

      const createApiContext = (owner: string, repo: string) => {
        return {
          owner,
          repo<T>(object: T) {
            return {
              owner,
              repo,
              ...object,
            };
          },
        };
      };

      const github: TestRunner["github"] = createGithubApi(
        octokit,
        createApiContext("rezsensent", "rezensent-test"),
        () => getCredentials(octokit)
      );

      try {
        await test({
          testId,
          log,
          logStep: (name) => {
            const line = chalk`  ├── {white.dim.inverse  ${name} } ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────`;
            logs.push(sliceAnsi(line, 0, 110));
            logs.push(`  │`);
          },
          cleanupTasks,
          skipCleanup: () => (doCleanup = false),

          github,
          async createUserGithub(repo: string) {
            const octokit = await createUserOctokit();

            const getUser = async () => {
              const {
                data: { name, login, email },
              } = await octokit.users.getAuthenticated();
              return {
                name: name ?? "",
                login,
                email: email ?? "",
                token: process.env["USER_TOKEN"] ?? "",
              };
            };

            const user = await getUser();

            return createGithubApi(
              octokit,
              createApiContext(user.login, repo),
              getUser
            );
          },

          async gitClone(githubApi: GithubApi = github) {
            const { git, directory } = await setupGit(githubApi);
            cleanupTasks.push(() =>
              fsp.rm(directory, { recursive: true, force: true })
            );

            const api: Awaited<ReturnType<TestRunner["gitClone"]>>["git"] = {
              fetch: () => fetch({ git, testId, log }),
              getSha: (name) => getSha({ git, testId, log }, name),

              hasBranch: async (name) => hasBranch({ git, testId, log }, name),
              createBranch: async (name) => {
                const branch = await createBranch({ git, testId, log }, name);
                api.deleteBranchAfterTest(branch);
                return branch;
              },
              deleteBranch: (name) => deleteBranch({ git, testId, log }, name),
              deleteBranchAfterTest: (name) =>
                cleanupTasks.push(async () => {
                  try {
                    await deleteBranch(
                      { git, testId, log: () => undefined },
                      name
                    );
                  } catch {
                    // ignore: branch was most likely already deleted
                  }
                }),
              waitForBranchToBeUpdated: (name, sha, timeout = Seconds.sixty) =>
                waitForBranchToBeUpdated(
                  { git, testId, log },
                  name,
                  sha,
                  timeout
                ),
              waitForBranchToBeDeleted: (name, timeout = Seconds.sixty) =>
                waitForBranchToBeDeleted({ git, testId, log }, name, timeout),

              writeFiles: (files) => writeFiles(directory, files),

              push: (branch) => pushBranch(git, testId, branch),
              addAndCommitChanges: (message) =>
                addAndCommitChanges({ git, testId, log }, message),
              addAndPushAllChanges: (branch, message) =>
                addAndPushAllChanges(git, testId, branch, message),
            };

            return {
              simpleGit: git,
              directory,
              git: api,
            };
          },
        });
      } finally {
        if (doCleanup && cleanupTasks.length > 0) {
          for (const task of cleanupTasks.reverse()) {
            try {
              await task();
            } catch (e) {
              console.warn("Failed to run cleanup", e);
            }
          }
        }
      }
    } finally {
      eventSource.close();
      await server?.stop();

      logs.push(
        `  └───────────────────────────────────────────────────────────────────────────────────────────────────────────`
      );

      logs.forEach((line) => {
        process.stdout.write(line + "\n");
      });
    }
  };
}
