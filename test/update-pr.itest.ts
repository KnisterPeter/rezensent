import { stripIndent } from "common-tags";
import { promises as fsp } from "fs";
import { join } from "path";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent update rezensent pull-request workflow",
  setupApp(async ({ logStep, log, gitClone, github, createUserGithub }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //
    const app = await github.getUser();
    const userGithub = await createUserGithub("rezensent-test");

    const managedReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Managed Review (update pr)",
    });

    const teamReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Review Requested (update pr)",
    });

    const { directory, git, simpleGit } = await gitClone(userGithub);

    //----------------------------------------
    //
    logStep("Setup repo (branches, ...)");

    const mainBranch = await git.createBranch("update-pr-test");
    await git.writeFiles({
      ".github/CODEOWNERS": stripIndent`
        folder-a @team-a
        folder-b @team-b
      `,
      ".github/rezensent.yml": stripIndent`
        manage-review-label: "${managedReviewLabel}"
        team-review-label: "${teamReviewLabel}"
      `,
    });
    await git.addAndPushAllChanges(mainBranch, "setup main branch (update-pr)");

    await git.fetch();

    //----------------------------------------
    //
    logStep("Prepare managed pull request");

    const changeBranch = await git.createBranch("some-changes-update-pr");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndCommitChanges("add some files across teams");
    await git.writeFiles({
      "folder-a/c.txt": `a`,
      "folder-b/b.txt": `not-b`,
      "folder-b/d.txt": `d`,
    });
    await git.addAndPushAllChanges(
      changeBranch,
      "some more changed files across teams"
    );

    const managedPrNumber = await userGithub.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Update PR Test",
    });
    await userGithub.addLabel(managedPrNumber, managedReviewLabel);
    const managedPr = await github.getPullRequest(managedPrNumber);

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

    await git.fetch();
    let teamABranchSha = await git.getSha(`origin/${changeBranch}-team-a`);
    let teamAPr = await userGithub.getPullRequest(splitTeamA);
    let teamBBranchSha = await git.getSha(`origin/${changeBranch}-team-b`);
    let teamBPr = await userGithub.getPullRequest(splitTeamB);

    //----------------------------------------
    //
    logStep("Update team-a pull request");

    await git.fetch();
    await simpleGit.checkout(`${changeBranch}-team-a`);

    await git.writeFiles({
      "folder-a/a.txt": `ab`,
      "folder-b/b2.txt": `b2`,
    });
    await git.addAndPushAllChanges(
      `${changeBranch}-team-a`,
      "update team-a change"
    );
    log(`Pushed changes onto ${changeBranch}-team-a`);

    await github.waitForPullRequestHeadToBeUpdated(
      managedPrNumber,
      managedPr.head.sha
    );

    //----------------------------------------
    //
    logStep("Team A pull request should include the changes");

    await git.waitForBranchToBeUpdated(
      `${changeBranch}-team-a`,
      teamABranchSha
    );

    await userGithub.waitForPullRequestHeadToBeUpdated(
      splitTeamA,
      teamAPr.head.sha
    );

    await git.fetch();
    await simpleGit.checkout(`${changeBranch}-team-a`);
    await simpleGit.pull("origin", `${changeBranch}-team-a`);
    const contentA = await fsp.readFile(
      join(directory, "folder-a/a.txt"),
      "utf-8"
    );
    expect(contentA).toBe("ab");

    //----------------------------------------
    //
    logStep("Team B pull request should include the changes");

    await git.waitForBranchToBeUpdated(
      `${changeBranch}-team-b`,
      teamBBranchSha
    );

    await userGithub.waitForPullRequestHeadToBeUpdated(
      splitTeamB,
      teamBPr.head.sha
    );

    await git.fetch();
    await simpleGit.checkout(`${changeBranch}-team-b`);
    await simpleGit.pull("origin", `${changeBranch}-team-b`);
    const contentB = await fsp.readFile(
      join(directory, "folder-b/b2.txt"),
      "utf-8"
    );
    expect(contentB).toBe("b2");

    // todo: close managed pr
    // todo: check that all review prs get closed
  })
);
