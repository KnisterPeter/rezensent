import { stripIndent } from "common-tags";
import { setupApp, Minutes, waitFor } from "./helper";

jest.setTimeout(Minutes.fifteen);

process.env["SCHEDULE_DELAY"] = String(1000 * 10);
process.env["SCHEDULE_TIMEOUT"] = String(1000 * 15);

test(
  "Scheduler test (to handle missing webhooks)",
  setupApp(
    async ({
      testId,
      log,
      logStep,
      gitClone,
      createUserGithub,
      github,
      cleanupTasks,
    }) => {
      //----------------------------------------
      // setup repo, add bot, ...
      //

      const app = await github.getUser();

      const appInstallationId = 15937473;
      // note: using a different testId here is intended
      // we do not want to receive webhooks in this test
      const repo = `${testId}changed-rezensent-scheduler-test`;
      const userGithub = await createUserGithub(repo);
      const { octokit: userOctokit } = userGithub;
      const { login: owner } = await userGithub.getUser();

      log("Create repository");
      const {
        data: repoData,
      } = await userOctokit.repos.createForAuthenticatedUser({
        name: repo,
        auto_init: true,
        has_downloads: false,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });
      cleanupTasks.push(async () => {
        await userOctokit.repos.delete({
          owner,
          repo: repo,
        });
      });
      // wait for repository to be created
      await waitFor(async () => {
        try {
          await userOctokit.repos.get({
            owner,
            repo,
          });
          return true;
        } catch {
          return undefined;
        }
      }, Minutes.one);

      const { git, simpleGit } = await gitClone(userGithub);

      const mainBranch = `main`;
      await git.writeFiles({
        ".github/CODEOWNERS": stripIndent`
          folder-a @team-a
          folder-b @team-b
        `,
        ".github/rezensent.yml": stripIndent`
          manage-review-label: "[${testId}] Rezensent: Managed Review"
          team-review-label: "[${testId}] Rezensent: Review Requested"
        `,
      });
      await simpleGit.add(["."]);
      await simpleGit.commit("chore: setup");
      await simpleGit.push("origin", "main");

      log("Add rezensent app to repository");
      await userOctokit.apps.addRepoToInstallation({
        installation_id: appInstallationId,
        repository_id: repoData.id,
      });
      cleanupTasks.push(async () => {
        await userOctokit.apps.removeRepoFromInstallation({
          installation_id: appInstallationId,
          repository_id: repoData.id,
        });
      });

      //----------------------------------------
      //
      logStep("Prepare managed pull request");

      const changeBranch = await git.createBranch("some-changes-scheduler");
      await git.writeFiles({
        "folder-a/a.txt": `a`,
        "folder-b/b.txt": `b`,
      });
      await git.addAndPushAllChanges(
        changeBranch,
        "add some files across teams"
      );

      const {
        data: { number: managedPrNumber },
      } = await userOctokit.pulls.create(
        userGithub.context.repo({
          base: mainBranch,
          head: changeBranch,
          title: "Scheduler Test",
          body: `### :grinning: body`,
        })
      );
      await userGithub.addLabel(
        managedPrNumber,
        `[${testId}] Rezensent: Managed Review`
      );

      //----------------------------------------
      // wait for bot work
      //
      logStep("Wait for bot work");

      const splitTeamA = await userGithub.waitForPullRequest({
        head: `${changeBranch}-team-a`,
        state: "open",
        user: app.login,
      });
      userGithub.closePullRequestAfterTest(splitTeamA);
      git.deleteBranchAfterTest(`${changeBranch}-team-a`);

      const splitTeamB = await userGithub.waitForPullRequest({
        head: `${changeBranch}-team-b`,
        state: "open",
        user: app.login,
      });
      userGithub.closePullRequestAfterTest(splitTeamB);
      git.deleteBranchAfterTest(`${changeBranch}-team-b`);
    }
  )
);
