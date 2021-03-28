import SimpleGit, {
  SimpleGit as GitType,
  ResetMode,
  GitResponseError,
  MergeResult,
} from "simple-git";
import { promises as fsp } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { URL } from "url";

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

    // const { name, email } = await this.getCredentials();
    await git.addConfig("user.name", user);
    await git.addConfig("user.email", email);

    return new Git(baseDir, git);
  } catch (e) {
    await fsp.rm(baseDir, { recursive: true, force: true });

    throw e;
  }
}
