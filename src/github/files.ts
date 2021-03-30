import { Context } from "probot";

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
    }),
    ({ data: files }) => files.map((file) => file.filename)
  );
}

export async function getFile(
  context: Context,
  {
    branch,
    path,
  }: {
    branch: string;
    path: string;
  }
): Promise<string> {
  const { data } = await context.octokit.repos.getContent(
    context.repo({
      ref: branch,
      path,
    })
  );
  if (typeof data !== "object" || !("content" in data)) {
    throw new Error(`File '${path}' not found`);
  }

  return Buffer.from(data.content, "base64").toString().replace("\\n", "\n");
}

export async function getChangedFilesPerTeam(
  context: Context,
  { number, patterns }: { number: number; patterns: Map<string, string[]> }
): Promise<Map<string, string[]>> {
  const changedFiles = await getPullRequestFiles(context, {
    number,
  });

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
