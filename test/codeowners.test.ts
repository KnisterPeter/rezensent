import { stripIndent } from "common-tags";

import { getTeams, getPatternsByTeam } from "../src/codeowners";

test("getTeams", () => {
  const teams = getTeams({
    file: stripIndent`
      folder-a @team-a
      folder-c @team-a
      folder-b @team-b
    `,
  });

  expect(teams).toEqual(expect.arrayContaining(["team-a", "team-b"]));
});

test("getCodeOwnerPatterns", () => {
  const codeowners = stripIndent`
    folder-a @team-a
    folder-c @team-a
    folder-b @team-b
  `;

  const teamA = getPatternsByTeam({
    file: codeowners,
    team: "team-a",
  });

  expect(teamA).toEqual(
    expect.arrayContaining(["^folder-a.*$", "^folder-c.*$"])
  );

  const teamB = getPatternsByTeam({
    file: codeowners,
    team: "team-b",
  });

  expect(teamB).toEqual(expect.arrayContaining(["^folder-b.*$"]));
});
