import { stripIndent } from "common-tags";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent unlabeled workflow",
  setupApp(async ({ logStep, gitClone, user, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //

    const managedReviewLabel = await github.createLabel({
      name: "Rezensent: Managed Review (unlabeled)",
    });

    const teamReviewLabel = await github.createLabel({
      name: "Rezensent: Review Requested (unlabeled)",
    });

    const { git } = await gitClone();

    //----------------------------------------
    //
    logStep("Setup repo (branches, ...)");

    const mainBranch = await git.createBranch("unlabeled-test");
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
    await git.addAndPushAllChanges(mainBranch, "setup unlabeled branch");

    //----------------------------------------
    //
    logStep("Prepare base pull request");

    const changeBranch = await git.createBranch("some-changes-unlabeled");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const basePrNumber = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Unlabeled Test",
    });
    await github.addLabel(basePrNumber, managedReviewLabel);
    const basePr = await github.getPullRequest(basePrNumber);

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
    logStep("Un-label base pr");

    const splitTeamAPr = await github.getPullRequest(splitTeamA);
    const splitTeamBPr = await github.getPullRequest(splitTeamB);

    await github.removeLabel(basePrNumber, managedReviewLabel);

    //----------------------------------------
    //
    logStep("All rezensent pull request should be closed");

    await git.waitForBranchToBeDeleted(splitTeamAPr.head.ref);
    await git.waitForBranchToBeDeleted(splitTeamBPr.head.ref);

    await github.waitForPullRequest({
      head: splitTeamAPr.head.ref,
      state: "closed",
    });

    await github.waitForPullRequest({
      head: splitTeamBPr.head.ref,
      state: "closed",
    });

    await github.waitForCommitStatus(
      { ref: basePr.head.ref },
      {
        context: "rezensent",
        state: "success",
      }
    );
  })
);
