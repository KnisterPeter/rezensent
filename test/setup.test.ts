import chalk from "chalk";
import { ProbotOctokit } from "probot";
import { Minutes, setupApp } from "./helper";

jest.setTimeout(Minutes.fifteen);

const testName = "Rezensent setup workflow";

(() => {
  let jestTest = test;
  const token = process.env["USER_TOKEN"];
  if (!token) {
    jestTest = jestTest.skip;
    process.stderr.write(
      chalk`{yellow.inverse  WARN } Skipping '${testName}'; No USER_TOKEN provided\n`
    );
  }

  jestTest(
    testName,
    setupApp(async ({}) => {
      //----------------------------------------
      // setup bot (labels, ...)
      //

      const userOctokit = new ProbotOctokit({ auth: { token: "abc" } });
      const {
        data: { login: owner },
      } = await userOctokit.users.getAuthenticated();
      const repo = "rezensent-setup-test";
      await userOctokit.repos.createForAuthenticatedUser({
        name: repo,
        auto_init: true,
        has_downloads: false,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
        homepage: "https://github.com/KnisterPeter/rezensent",
      });

      await userOctokit.repos.delete({
        owner,
        repo: repo,
      });
    })
  );
})();
