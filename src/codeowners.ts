export function getTeams({ file }: { file: string }): string[] {
  return Array.from(
    file.split(/\n/).reduce((set, line) => {
      const [_, team] = line.split(/\s+/);
      if (team && team.startsWith("@")) {
        set.add(team.substr(1));
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
    .filter(([, t]) => t?.startsWith("@") && t.substr(1) === team)
    .map(([path]) => `^${path}.*$`);
}
