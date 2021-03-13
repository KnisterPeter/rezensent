import { config as dotEnvConfig } from "dotenv";
import { ProbotOctokit } from "probot";
import type EventSource from "eventsource";
import SmeeClient from "smee-client";
import Git, { SimpleGit } from "simple-git";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { URL } from "url";

import type { Endpoints } from "@octokit/types";

import { startServer, Server } from "../src/node";

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
    str += chars[Math.round(Math.random() * chars.length)];
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
              if (head === testify(head, this.#testId, "%s-%t")) {
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
  repo<T>(object: T) {
    return {
      owner: "KnisterPeter",
      repo: "rezensent-test",
      ...object,
    };
  },
};

function testify(str: string, testId: string, test = "[%t] %s"): string {
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
export type CreateLabelParams = Endpoints["POST /repos/{owner}/{repo}/labels"]["parameters"];

export type TestRunner = {
  testId: string;

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
  };

  gitClone(): Promise<{
    directory: string;
    simpleGit: SimpleGit;
    git: {
      createBranch(name: string): Promise<string>;
      deleteBranch(name: string): Promise<void>;
      deleteBranchAfterTest(name: string): void;

      addAndPushAllChanges(branch: string, message: string): Promise<void>;
    };
  }>;
};

export type AuthenticatedOctokit = Awaited<
  ReturnType<typeof createAuthenticatedOctokit>
>;

export async function createLabel(
  octokit: AuthenticatedOctokit,
  testId: string,
  { name = "label", description, color }: Partial<CreateLabelParams>
): Promise<string> {
  console.log(`[${testId}] Create label ${name}`);

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
  octokit: AuthenticatedOctokit,
  testId: string,
  name: string
): Promise<void> {
  console.log(`[${testId}] Delete label ${name}`);

  await octokit.issues.deleteLabel(
    context.repo({
      name: testify(name, testId),
    })
  );
}

export async function createPullRequest(
  octokit: AuthenticatedOctokit,
  testId: string,
  {
    base = "main",
    head = "pull-request",
    title = "Title",
    body = undefined,
    draft = false,
  }: Partial<CreatePullRequestParams>
): Promise<number> {
  console.log(`[${testId}] Create pull request [title=${title}]`);

  const {
    data: { number },
  } = await octokit.pulls.create(
    context.repo({
      base,
      head: testify(head, testId, "%s-%t"),
      title: testify(title, testId),
      body,
      draft,
    })
  );

  console.log(`[${testId}] Created pull request [number=${number}]`);
  return number;
}

export async function closePullRequest(
  octokit: AuthenticatedOctokit,
  testId: string,
  number: number
): Promise<void> {
  console.log(`[${testId}] Close pull request [number=${number}]`);

  await octokit.pulls.update(
    context.repo({
      pull_number: number,
      state: "closed",
    })
  );
}

export async function getCredentials(
  octokit: AuthenticatedOctokit
): Promise<{
  name: string;
  login: string;
  email: string;
  id: number;
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
    id: user.id,
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

export async function createBranch(
  git: SimpleGit,
  testId: string,
  name: string
): Promise<string> {
  console.log(`[${testId}] Crate branch [name=${name}]`);

  const branchName = testify(name, testId, "%s-%t");
  await git.checkout(["-b", branchName]);
  return branchName;
}

export async function deleteBranch(
  git: SimpleGit,
  testId: string,
  name: string
): Promise<void> {
  console.log(`[${testId}] Delete branch [name=${name}]`);

  const branchName = testify(name, testId, "%s-%t");

  await git.push(["origin", "--delete", branchName]);
}

export async function addAndPushAllChanges(
  git: SimpleGit,
  testId: string,
  branch: string,
  message: string
): Promise<void> {
  await git
    .add(["."])
    .commit(message)
    .push(["origin", testify(branch, testId, "%s-%t")]);
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

          octokit,
          github: {
            createLabel: (params) => createLabel(octokit, testId, params),
            deleteLabel: (name) => deleteLabel(octokit, testId, name),
            deleteLabelAfterTest: (name) =>
              cleanupTasks.push(() => deleteLabel(octokit, testId, name)),

            createPullRequest: (params) =>
              createPullRequest(octokit, testId, params),
            closePullRequest: (number) =>
              closePullRequest(octokit, testId, number),
            closePullRequestAfterTest: (number) =>
              cleanupTasks.push(() =>
                closePullRequest(octokit, testId, number)
              ),
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
                createBranch: (name) => createBranch(git, testId, name),
                deleteBranch: (name) => deleteBranch(git, testId, name),
                deleteBranchAfterTest: (name) =>
                  cleanupTasks.push(() => deleteBranch(git, testId, name)),

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
