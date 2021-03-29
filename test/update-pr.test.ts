import { stripIndent } from "common-tags";
import { promises as fsp } from "fs";
import { join } from "path";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent update rezensent pull-request workflow",
  setupApp(async ({ logStep, gitClone, user, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //

    const managedReviewLabel = await github.createLabel({
      name: "Rezensent: Managed Review (update pr)",
    });

    const teamReviewLabel = await github.createLabel({
      name: "Rezensent: Review Requested (update pr)",
    });

    const { directory, git, simpleGit } = await gitClone();

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
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const managedPrNumber = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Update PR Test",
    });
    await github.addLabel(managedPrNumber, managedReviewLabel);

    //----------------------------------------
    // wait for bot work
    //
    logStep("Wait for bot work");

    const [splitTeamA, splitTeamB] = await Promise.all([
      github.waitForPullRequest({
        head: `${changeBranch}-team-a`,
        state: "open",
        user: user.login,
      }),
      github.waitForPullRequest({
        head: `${changeBranch}-team-b`,
        state: "open",
        user: user.login,
      }),
    ]);

    github.closePullRequestAfterTest(splitTeamA);
    github.closePullRequestAfterTest(splitTeamB);
    git.deleteBranchAfterTest(`${changeBranch}-team-a`);
    git.deleteBranchAfterTest(`${changeBranch}-team-b`);

    await git.fetch();
    let teamABranchSha = await git.getSha(`origin/${changeBranch}-team-a`);
    let teamAPr = await github.getPullRequest(splitTeamA);
    let teamBBranchSha = await git.getSha(`origin/${changeBranch}-team-b`);
    let teamBPr = await github.getPullRequest(splitTeamB);

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

    //----------------------------------------
    //
    logStep("Team A pull request should include the changes");

    await git.waitForBranchToBeUpdated(
      `${changeBranch}-team-a`,
      teamABranchSha
    );

    await github.waitForPullRequestHeadToBeUpdated(
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

    await github.waitForPullRequestHeadToBeUpdated(
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
  })
);
