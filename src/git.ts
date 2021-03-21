import SimpleGit, { SimpleGit as GitType, ResetMode } from "simple-git";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { URL } from "url";

import { BotContext } from "./bot-context";

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

  async checkout(sha: string): Promise<void> {
    await this.#git.checkout([sha]);
  }

  async rebase(ref: string): Promise<void> {
    await this.#git.fetch("origin", ref).rebase([`origin/${ref}`]);
  }

  async resetCommits(sha = "HEAD^"): Promise<string> {
    await this.#git.reset(ResetMode.MIXED, [sha]);
    return await this.#git.revparse(["HEAD"]);
  }

  async addToNewBranch(
    { log }: BotContext,
    {
      branch,
      startPoint,
      files,
    }: {
      branch: string;
      startPoint?: string;
      files: string[];
    }
  ): Promise<void> {
    const args = ["-b", branch];
    if (startPoint) {
      args.push(startPoint);
    }
    log.debug(`git checkout ${args.join(" ")}`);
    await this.#git.checkout(args);

    log.debug(`git add ${files.join(" ")}`);
    await this.#git.add(files);
  }

  async commitAndPush(
    { log }: BotContext,
    {
      message,
      branch,
    }: {
      message: string;
      branch: string;
    }
  ): Promise<void> {
    log.debug(`git commit -m "..."`);
    const commit = await this.#git.commit(message);
    log.debug(commit, `commit result`);

    log.debug(`git push origin ${branch}`);
    try {
      const push = await this.#git.push("origin", branch);
      log.debug(push, `push result`);
    } catch (e) {
      log.error(e, `push failed :-(`);
      throw e;
    }
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

    // const { name, email } = await this.getCredentials();
    await git.addConfig("user.name", user);
    await git.addConfig("user.email", email);

    return new Git(baseDir, git);
  } catch (e) {
    await fsp.rm(baseDir, { recursive: true, force: true });

    throw e;
  }
}
