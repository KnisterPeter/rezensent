import SimpleGit, {
  SimpleGit as GitType,
  ResetMode,
  GitResponseError,
  MergeResult,
  CleanOptions,
} from "simple-git";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { URL } from "url";
import { PullRequestBase } from "./pr/matcher";

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

  async cleanAll(): Promise<void> {
    await this.#git.clean([
      CleanOptions.RECURSIVE,
      CleanOptions.IGNORED_INCLUDED,
      CleanOptions.FORCE,
    ]);
  }

  async createReviewBranch({
    fromPullRequest,
    toBranch,
    team,
    files,
  }: {
    fromPullRequest: PullRequestBase;
    toBranch: string;
    team: string;
    files: string[];
  }): Promise<void> {
    // prepare
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.sha]);

    await this.#git.reset(ResetMode.HARD, [fromPullRequest.head.sha]);
    await this.#git.reset(ResetMode.SOFT, [fromPullRequest.base.sha]);
    await this.#git.raw(["restore", "--staged", "."]);
    await this.#git.add(files);
    await this.#git.commit(`changes for ${team}`);
    await this.#git.raw(["branch", toBranch]);

    // cleanup
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.ref]);
  }

  async updateReviewBranch({
    fromPullRequest,
    toBranch,
    team,
    files,
  }: {
    fromPullRequest: PullRequestBase;
    toBranch: string;
    team: string;
    files: string[];
  }): Promise<void> {
    // prepare
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.ref]);

    await this.#git.reset(ResetMode.HARD, [fromPullRequest.head.sha]);
    await this.#git.fetch(["origin", toBranch]);
    await this.#git.rebase([
      "--onto",
      `origin/${toBranch}`,
      fromPullRequest.base.sha,
    ]);
    await this.#git.reset(ResetMode.SOFT, [`origin/${toBranch}`]);
    await this.#git.raw(["restore", "--staged", "."]);
    await this.#git.add(files);
    await this.#git.commit(`updates for ${team}`);
    const sha = await this.#git.revparse(["HEAD"]);
    await this.#git.checkout([toBranch]);
    await this.#git.reset(ResetMode.HARD, [sha]);

    // cleanup
    await this.cleanAll();
    await this.#git.checkout([fromPullRequest.head.ref]);
  }

  async checkout(sha: string): Promise<void> {
    await this.#git.checkout([sha]);
  }

  async rebase(ref: string): Promise<void> {
    await this.#git.fetch("origin", ref);
    await this.#git.rebase([`origin/${ref}`]);
  }

  async mergeTheirs(from: string): Promise<string> {
    await this.#git.fetch("origin", from);
    try {
      await this.#git.merge([
        "--no-edit",
        "--strategy=recursive",
        "--strategy-option=theirs",
        `origin/${from}`,
      ]);
    } catch (e) {
      const result:
        | MergeResult
        | undefined = (e as GitResponseError<MergeResult>).git;
      if (result?.result !== "success") {
        throw e;
      }
    }

    return await this.#git.revparse(["HEAD"]);
  }

  async resetCommits(sha = "HEAD^"): Promise<string> {
    await this.#git.reset(ResetMode.MIXED, [sha]);
    return await this.#git.revparse(["HEAD"]);
  }

  async resetHardCommits(sha = "HEAD^"): Promise<string> {
    await this.#git.reset(ResetMode.HARD, [sha]);
    return await this.#git.revparse(["HEAD"]);
  }

  async cherryPick({
    commit,
    onto,
  }: {
    commit: string;
    onto: string;
  }): Promise<string> {
    await this.#git.fetch("origin", onto);
    await this.#git.checkout([onto]);

    await this.#git.raw(["cherry-pick", commit]);
    const newCommitId = await this.#git.revparse(["HEAD"]);

    await this.push(onto);

    return newCommitId;
  }

  async addToExistingBranch({
    branch,
    files,
  }: {
    branch: string;
    files: string[];
  }): Promise<void> {
    await this.#git.fetch("origin", branch);
    await this.#git.checkout([branch]);
    await this.#git.add(files);
  }

  async addToNewBranch({
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

  async commitAndPush({
    message,
    branch,
  }: {
    message: string;
    branch: string;
  }): Promise<void> {
    await this.#git.commit(message);

    await this.#git.push("origin", branch);
  }

  async push(branch: string): Promise<void> {
    await this.#git.push(["origin", branch]);
  }

  async forcePush(branch: string): Promise<void> {
    await this.#git.push(["--force", "origin", branch]);
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
