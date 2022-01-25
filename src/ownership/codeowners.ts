import { Context } from "probot";
import { getFile } from "../github/files";

export function getTeams({ file }: { file: string }): string[] {
  return Array.from(
    file.split(/\n/).reduce((set, line) => {
      const [_, team] = line.split(/\s+/);
      if (team && team.startsWith("@")) {
        set.add(team.substring(1));
      }
      return set;
    }, new Set<string>())
  );
}

export function getPatternsByTeam({
  file,
  team,
}: {
  file: string;
  team: string;
}): string[] {
  return file
    .split(/\n/)
    .map((line) => line.split(/\s+/))
    .filter(([, t]) => t?.startsWith("@") && t.substring(1) === team)
    .map(([path]) => (path === "*" ? "^.*$" : `^${path}.*$`));
}

export async function getFilePatternMapPerTeam(
  context: Context,
  { branch }: { branch: string }
): Promise<Map<string, string[]>> {
  let codeowners: string;
  try {
    codeowners = await getFile(context, {
      branch,
      path: ".github/CODEOWNERS",
    });
  } catch {
    context.log.error(
      `Failed to read '.github/CODEOWNERS'; No team patterns available`
    );
    return new Map();
  }

  const patterns = getTeams({
    file: codeowners,
  }).reduce((map, team) => {
    map.set(team, getPatternsByTeam({ file: codeowners, team }));
    return map;
  }, new Map<string, string[]>());

  return patterns;
}
