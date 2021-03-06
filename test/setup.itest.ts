import { Minutes, setupApp, waitFor } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent setup workflow",
  setupApp(
    async ({
      logStep,
      log,
      testId,
      cleanupTasks,
      createUserGithub,
      github,
      gitClone,
    }) => {
      //----------------------------------------
      // setup repo, add bot, ...
      //

      const app = await github.getUser();

      const appInstallationId = 15937473;
      const repo = `${testId}-rezensent-setup-test`;
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
      const mainSha = await simpleGit.revparse(["main"]);

      await git.writeFiles({
        ".github/CODEOWNERS": `* @rezensent`,
      });
      await simpleGit.add(["."]);
      await simpleGit.commit("chore: add codeowners");
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
      logStep("Setup pull request");

      const setupPrNumber = await userGithub.waitForPullRequest({
        user: app.login,
      });

      let setupPr = await userGithub.getPullRequest(setupPrNumber);
      expect(setupPr.title).toBe(`Configure rezensent`);

      const setupFiles = await userGithub.getPullRequestFiles(setupPrNumber);
      expect(setupFiles).toEqual(
        expect.arrayContaining([".github/rezensent.yml"])
      );

      await userOctokit.pulls.update({
        owner,
        repo,
        pull_number: setupPrNumber,
        title: `[${testId}] ${setupPr.title}`,
      });

      await userGithub.mergePullRequest(setupPrNumber);

      //----------------------------------------
      //
      logStep("Wait for setup to be executed");

      log("Wait for main branch to be updated");
      await waitFor(async () => {
        await simpleGit.fetch();
        const sha = await simpleGit.revparse(`origin/main`);
        return sha === mainSha ? undefined : sha;
      }, Minutes.one);

      log("Wait for labels to be created");
      const labels = await waitFor(async () => {
        const {
          data: labels,
        } = await userGithub.octokit.issues.listLabelsForRepo(
          userGithub.context.repo({})
        );
        const matchingLabels = labels.filter((label) =>
          label.name.includes("Rezensent")
        );
        return matchingLabels.length >= 2 ? labels : undefined;
      }, Minutes.one);

      expect(labels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Rezensent: Managed Review",
          }),
          expect.objectContaining({
            name: "Rezensent: Review Requested",
          }),
        ])
      );
    }
  )
);
