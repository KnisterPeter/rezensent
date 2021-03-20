import { config as dotEnvConfig } from "dotenv";
import { ProbotOctokit } from "probot";
import type EventSource from "eventsource";
import SmeeClient from "smee-client";
import Git, { SimpleGit } from "simple-git";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { URL } from "url";
import { promisify } from "util";

import type { Endpoints } from "@octokit/types";

import { startServer, Server } from "../src/node";

const wait = promisify(setTimeout);
export const enum Seconds {
  one = 1000 * 1,
  two = 1000 * 2,
  ten = 1000 * 10,
  thirty = 1000 * 30,
  sixty = 1000 * 60,
}
export const titlePattern = "[%t] %s";
export const branchPattern = "%t-%s";

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
    ...options
  }: ConstructorParameters<typeof SmeeClient>[0] & { testId: string }) {
    super(options);
    this.#testId = options.testId;
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
          case "pull_request":
            try {
              const title = get<string>(data, "body.pull_request.title");
              if (title === testify(title, this.#testId)) {
                return super.onmessage(msg);
              }
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

function getAppOctokit() {
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
  const appOctokit = getAppOctokit();

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

export async function createAuthenticatedOctokit(): Promise<
  InstanceType<typeof ProbotOctokit>
> {
  const token = await getAccessToken();

  return new ProbotOctokit({
    auth: { token },
  });
}

export const context = {
  owner: "KnisterPeter",
  repo<T>(object: T) {
    return {
      owner: "KnisterPeter",
      repo: "rezensent-test",
      ...object,
    };
  },
};

function testify(str: string, testId: string, test = titlePattern): string {
  const pattern = test
    .replace("[", "\\[")
    .replace("]", "\\]")
    .replace("(", "\\(")
    .replace(")", "\\)")
    .replace("%s", ".*?")
    .replace("%t", testId);
  const regexp = new RegExp(pattern);

  return regexp.test(str) ? str : test.replace("%s", str).replace("%t", testId);
}

export type CreatePullRequestParams = Endpoints["POST /repos/{owner}/{repo}/pulls"]["parameters"];
export type ListPullRequestParams = Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"] & {
  user: string;
  assignee: string;
  labels: string[];
};
export type ListPullRequestResponse = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][number];
export type CreateLabelParams = Endpoints["POST /repos/{owner}/{repo}/labels"]["parameters"];

async function waitFor<Result>(
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

export type TestRunner = {
  testId: string;
  user: {
    name: string;
    login: string;
    email: string;
  };

  octokit: AuthenticatedOctokit;
  github: {
    createLabel(params: Partial<CreateLabelParams>): Promise<string>;
    deleteLabel(name: string): Promise<void>;
    deleteLabelAfterTest(name: string): void;

    createPullRequest(
      params: Partial<CreatePullRequestParams>
    ): Promise<number>;
    closePullRequest(number: number): Promise<void>;
    closePullRequestAfterTest(number: number): void;
    mergePullRequest(number: number): Promise<void>;

    waitForPullRequest(
      params: Partial<ListPullRequestParams>,
      timeout?: number
    ): Promise<number>;
  };

  gitClone(): Promise<{
    directory: string;
    simpleGit: SimpleGit;
    git: {
      createBranch(name: string): Promise<string>;
      deleteBranch(name: string): Promise<void>;
      deleteBranchAfterTest(name: string): void;

      writeFiles(files: { [path: string]: string }): Promise<void>;

      push(branch: string): Promise<void>;
      addAndPushAllChanges(branch: string, message: string): Promise<void>;
    };
  }>;
};

export type AuthenticatedOctokit = Awaited<
  ReturnType<typeof createAuthenticatedOctokit>
>;

export interface OctokitTaskContext {
  octokit: AuthenticatedOctokit;
  testId: string;
  log: typeof console["log"];
}

export async function createLabel(
  { octokit, testId, log }: OctokitTaskContext,
  { name = "label", description, color }: Partial<CreateLabelParams>
): Promise<string> {
  log(`[${testId}] Create label ${name}`);

  const {
    data: { name: labelName },
  } = await octokit.issues.createLabel(
    context.repo({
      name: testify(name, testId),
      description,
      color,
    })
  );

  return labelName;
}

export async function deleteLabel(
  { octokit, testId, log }: OctokitTaskContext,
  name: string
): Promise<void> {
  log(`[${testId}] Delete label ${name}`);

  await octokit.issues.deleteLabel(
    context.repo({
      name: testify(name, testId),
    })
  );
}

export async function createPullRequest(
  { octokit, testId, log }: OctokitTaskContext,
  {
    base = "main",
    head = "pull-request",
    title = "Title",
    body = undefined,
    draft = false,
  }: Partial<CreatePullRequestParams>
): Promise<number> {
  log(`[${testId}] Create pull request [title=${title}]`);

  const {
    data: { number },
  } = await octokit.pulls.create(
    context.repo({
      base: testify(base, testId, branchPattern),
      head: testify(head, testId, branchPattern),
      title: testify(title, testId),
      body,
      draft,
    })
  );

  log(`[${testId}] Created pull request [number=${number}]`);
  return number;
}

export async function listPullRequests(
  { octokit, testId, log }: OctokitTaskContext,
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
  log(`[${testId}] List pull requests`);

  let { data: list } = await octokit.pulls.list(
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
  { octokit, testId, log }: OctokitTaskContext,
  number: number
): Promise<void> {
  log(`[${testId}] Close pull request [number=${number}]`);

  await octokit.pulls.update(
    context.repo({
      pull_number: number,
      state: "closed",
    })
  );
}

export async function mergePullRequest(
  { octokit, testId, log }: OctokitTaskContext,
  number: number
): Promise<void> {
  log(`[${testId}] Merge pull request [number=${number}]`);

  await octokit.pulls.merge(
    context.repo({
      pull_number: number,
    })
  );
}

export async function getCredentials(
  octokit: AuthenticatedOctokit
): Promise<{
  name: string;
  login: string;
  email: string;
}> {
  const appOctokit = getAppOctokit();

  const { data: authenticated } = await appOctokit.apps.getAuthenticated();
  const { data: user } = await octokit.users.getByUsername({
    username: `${authenticated.slug}[bot]`,
  });

  return {
    name: authenticated.name,
    login: user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
  };
}

export async function setupGit(
  octokit: AuthenticatedOctokit
): Promise<{ git: SimpleGit; directory: string }> {
  const baseDir = await fsp.mkdtemp(join(tmpdir(), "rezensent"));
  try {
    const git: SimpleGit = Git({ baseDir });

    const {
      data: { clone_url },
    } = await octokit.repos.get(context.repo({}));
    const url = new URL(clone_url);
    url.username = "x-access-token";
    url.password = await getAccessToken();

    await git.clone(url.toString(), baseDir);

    const { name, email } = await getCredentials(octokit);
    await git.addConfig("user.name", name);
    await git.addConfig("user.email", email);

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

export async function createBranch(
  { git, testId, log }: SimpleGitTaskContext,
  name: string
): Promise<string> {
  log(`[${testId}] Crate branch [name=${name}]`);

  const branchName = testify(name, testId, branchPattern);
  await git.checkout(["-b", branchName]);
  return branchName;
}

export async function deleteBranch(
  { git, testId, log }: SimpleGitTaskContext,
  name: string
): Promise<void> {
  log(`[${testId}] Delete branch [name=${name}]`);

  const branchName = testify(name, testId, branchPattern);

  await git.push(["origin", "--delete", branchName]);
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

export async function addAndPushAllChanges(
  git: SimpleGit,
  testId: string,
  branch: string,
  message: string
): Promise<void> {
  await git.add(["."]).commit(message);
  await pushBranch(git, testId, branch);
}

type Task = () => Promise<void>;

export function setupApp(
  test: (runner: TestRunner) => Promise<void>
): () => Promise<void> {
  return async () => {
    const testId = idGen(5);
    const eventSource = createEventSource(testId);

    try {
      const cleanupTasks: Task[] = [];
      const octokit = await createAuthenticatedOctokit();

      try {
        await test({
          testId,

          user: await getCredentials(octokit),
          octokit,
          github: {
            createLabel: (params) =>
              createLabel({ octokit, testId, log: console.log }, params),
            deleteLabel: (name) =>
              deleteLabel({ octokit, testId, log: console.log }, name),
            deleteLabelAfterTest: (name) =>
              cleanupTasks.push(() =>
                deleteLabel({ octokit, testId, log: () => undefined }, name)
              ),

            createPullRequest: (params) =>
              createPullRequest({ octokit, testId, log: console.log }, params),
            closePullRequest: (number) =>
              closePullRequest({ octokit, testId, log: console.log }, number),
            closePullRequestAfterTest: (number) =>
              cleanupTasks.push(() =>
                closePullRequest(
                  { octokit, testId, log: () => undefined },
                  number
                )
              ),
            mergePullRequest: (number) =>
              mergePullRequest({ octokit, testId, log: console.log }, number),

            waitForPullRequest: async (params, timeout = Seconds.ten) => {
              console.log(
                `[${testId}] Wait for pull request [timeout=${timeout / 1000}s]`
              );

              const pullRequest = await waitFor<ListPullRequestResponse>(
                async () => {
                  const list = await listPullRequests(
                    { octokit, testId, log: () => undefined },
                    params
                  );
                  return list.length > 0 ? list[0] : undefined;
                },
                timeout
              );

              return pullRequest.number;
            },
          },

          async gitClone() {
            const { git, directory } = await setupGit(octokit);
            cleanupTasks.push(() =>
              fsp.rm(directory, { recursive: true, force: true })
            );
            return {
              simpleGit: git,
              directory,
              git: {
                createBranch: (name) =>
                  createBranch({ git, testId, log: console.log }, name),
                deleteBranch: (name) =>
                  deleteBranch({ git, testId, log: console.log }, name),
                deleteBranchAfterTest: (name) =>
                  cleanupTasks.push(() =>
                    deleteBranch({ git, testId, log: () => undefined }, name)
                  ),

                writeFiles: (files) => writeFiles(directory, files),

                push: (branch) => pushBranch(git, testId, branch),
                addAndPushAllChanges: (branch, message) =>
                  addAndPushAllChanges(git, testId, branch, message),
              },
            };
          },
        });
      } finally {
        if (cleanupTasks.length > 0) {
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
    }
  };
}
