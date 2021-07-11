import type { WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

export async function getPullRequestFiles(
  context: Context,
  {
    number,
  }: {
    number: number;
  }
): Promise<string[]> {
  return await context.octokit.paginate(
    context.octokit.pulls.listFiles,
    context.repo({
      pull_number: number,
      per_page: 100,
    }),
    ({ data: files }) => files.map((file) => file.filename)
  );
}

export async function getFile(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  {
    branch,
    path,
  }: {
    branch: string;
    path: string;
  }
): Promise<string> {
  try {
    const { data } = await context.octokit.repos.getContent(
      context.repo({
        ref: branch,
        path,
      })
    );

    if (!("content" in data)) {
      return "";
    }

    return Buffer.from(data.content, "base64").toString().replace("\\n", "\n");
  } catch {
    throw new Error(`File '${path}' not found`);
  }
}

export function getMapOfChangedFilesPerTeam({
  changedFiles,
  patterns,
}: {
  changedFiles: string[];
  patterns: Map<string, string[]>;
}): Map<string, string[]> {
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
