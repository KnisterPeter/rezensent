import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import SimpleGit, {
  CleanOptions,
  ResetMode,
  SimpleGit as GitType,
} from "simple-git";
import { URL } from "url";
import { PullRequestBase } from "./matcher";

export class Git {
  #baseDir: string;
  #git: GitType;

  get directory() {
    return this.#baseDir;
  }

  constructor(baseDir: string, git: GitType) {
    this.#baseDir = baseDir;
    this.#git = git;
  }

  private async cleanAll(): Promise<void> {
    await this.#git.clean([
      CleanOptions.RECURSIVE,
      CleanOptions.IGNORED_INCLUDED,
      CleanOptions.FORCE,
    ]);
  }

  public async createReviewBranch({
    fromPullRequest,
    toBranch,
    files,
  }: {
    fromPullRequest: PullRequestBase;
    toBranch: string;
    files: string[];
  }): Promise<void> {
    const lastLog = async () =>
      (await this.#git.log(["-n", "1"])).latest?.message;

    // prepare
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.sha]);

    await this.#git.checkout(["-b", toBranch]);
    await this.#git.reset(ResetMode.HARD, [fromPullRequest.base.sha]);

    const commits = await this.#git.log([
      "--no-merges",
      "--reverse",
      `${fromPullRequest.base.sha}..${fromPullRequest.head.sha}`,
    ]);
    for (const { hash, message } of commits.all) {
      await this.#git.raw(["cherry-pick", hash]);
      await this.#git.reset(ResetMode.SOFT, ["HEAD^"]);
      if ((await lastLog()) === "##rezensent##temp##") {
        await this.#git.reset(ResetMode.SOFT, ["HEAD^"]);
      }
      await this.#git.raw(["restore", "--staged", "."]);
      for (const file of files) {
        try {
          await fsp.stat(join(this.directory, file));
          await this.#git.add(file);
        } catch {
          // just ignore non existing files
        }
      }
      await this.#git.commit(message);
      await this.#git.add(".");
      await this.#git.commit("##rezensent##temp##");
    }
    if ((await lastLog()) === "##rezensent##temp##") {
      await this.#git.reset(ResetMode.HARD, ["HEAD^"]);
    }

    // cleanup
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.ref]);
  }

  public async moveCommits({
    toBranch,
    commits,
  }: {
    toBranch: string;
    commits: string[];
  }): Promise<void> {
    // prepare
    await this.cleanAll();
    await this.#git.fetch(["origin", toBranch]);
    await this.#git.checkout([toBranch]);

    await this.#git.raw(["cherry-pick", ...commits]);
    await this.#git.push(["--force", "origin", toBranch]);

    // cleanup
    await this.cleanAll();
    await this.#git.checkout([toBranch]);
  }

  public async removeCommits({
    pullRequest,
    amount,
  }: {
    pullRequest: PullRequestBase;
    amount: number;
  }): Promise<void> {
    // prepare
    await this.cleanAll();
    await this.#git.checkout([pullRequest.head.ref]);

    await this.#git.reset(ResetMode.HARD, [`HEAD~${amount}`]);
    await this.#git.push(["--force", "origin", pullRequest.head.ref]);

    // cleanup
    await this.cleanAll();
    await this.#git.checkout([pullRequest.head.ref]);
  }

  async hasRemoteBranch(branch: string): Promise<boolean> {
    try {
      await this.#git.fetch("origin", branch);
      const summary = await this.#git.branch();
      return summary.all.includes(`remotes/origin/${branch}`);
    } catch {
      return false;
    }
  }

  public async addToNewBranch({
    branch,
    startPoint,
    files,
  }: {
    branch: string;
    startPoint?: string;
    files: string[];
  }): Promise<void> {
    const args = ["-b", branch];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.#git.checkout(args);

    await this.#git.add(files);
  }

  public async checkout(branch: string): Promise<void> {
    await this.#git.fetch(["origin", branch]);
    await this.#git.checkout([branch]);
  }

  public async addFiles(files: string[]): Promise<void> {
    await this.#git.add(files);
  }

  public async commitAndPush({
    message,
    branch,
  }: {
    message: string;
    branch: string;
  }): Promise<void> {
    const status = await this.#git.status();
    if (status.staged.length > 0) {
      await this.#git.commit(message);

      await this.#git.push("origin", branch);
    }
  }

  public async push({
    branch,
    force = false,
  }: {
    branch: string;
    force?: boolean;
  }): Promise<void> {
    const args = ["origin", branch];
    if (force) {
      args.unshift("--force");
    }
    await this.#git.push(args);
  }

  async close(): Promise<void> {
    await fsp.rm(this.#baseDir, { recursive: true, force: true });
  }
}

export async function clone({
  url,
  user,
  email,
  sha,
  depth = 1,
}: {
  url: URL;
  user: string;
  email: string;
  sha: string;
  depth?: number;
}): Promise<Git> {
  const baseDir = await fsp.mkdtemp(join(tmpdir(), "rezensent"));
  try {
    const git = SimpleGit({ baseDir });

    await git.init(["."]);
    await git.addRemote("origin", url.toString());
    await git.fetch("origin", sha, {
      "--depth": depth,
    });
    await git.checkout([sha]);

    await git.addConfig("user.name", user);
    await git.addConfig("user.email", email);

    return new Git(baseDir, git);
  } catch (e) {
    await fsp.rm(baseDir, { recursive: true, force: true });

    throw e;
  }
}
