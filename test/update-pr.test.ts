import { stripIndent } from "common-tags";

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

    const { git, simpleGit } = await gitClone();

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
    logStep("Prepare base pull request");

    const changeBranch = await git.createBranch("some-changes-update-pr");
    let changeBranchSha = await git.getSha(changeBranch);
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const basePrNumber = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Update PR Test",
    });
    await github.addLabel(basePrNumber, managedReviewLabel);
    let basePr = await github.getPullRequest(basePrNumber);

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

    //----------------------------------------
    //
    logStep("Update team-a pr");

    let teamAPr = await github.getPullRequest(splitTeamA);

    await git.fetch();
    await simpleGit.checkout(teamAPr.head.ref);

    await git.writeFiles({
      "folder-a/a.txt": `ab`,
    });
    await git.addAndPushAllChanges(teamAPr.head.ref, "update team-a change");

    //----------------------------------------
    //
    logStep("Base pull request should include the team-a changes");

    await git.waitForBranchToBeUpdated(changeBranch, changeBranchSha);

    await github.waitForPullRequestHeadToBeUpdated(
      basePrNumber,
      basePr.head.sha
    );
  })
);
