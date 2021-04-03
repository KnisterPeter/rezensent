import { stripIndent } from "common-tags";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent unlabeled workflow",
  setupApp(async ({ logStep, gitClone, github, createUserGithub }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //
    const app = await github.getUser();
    const userGithub = await createUserGithub("rezensent-test");

    const managedReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Managed Review (unlabeled)",
    });

    const teamReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Review Requested (unlabeled)",
    });

    const { git } = await gitClone(userGithub);

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
    logStep("Prepare managed pull request");

    const changeBranch = await git.createBranch("some-changes-unlabeled");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const managedPrNumber = await userGithub.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Unlabeled Test",
    });
    await userGithub.addLabel(managedPrNumber, managedReviewLabel);
    const managedPr = await userGithub.getPullRequest(managedPrNumber);

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

    //----------------------------------------
    //
    logStep("Un-label managed pull request");

    const splitTeamAPr = await userGithub.getPullRequest(splitTeamA);
    const splitTeamBPr = await userGithub.getPullRequest(splitTeamB);

    await userGithub.removeLabel(managedPrNumber, managedReviewLabel);

    //----------------------------------------
    //
    logStep("All rezensent pull request should be closed");

    await git.waitForBranchToBeDeleted(splitTeamAPr.head.ref);
    await git.waitForBranchToBeDeleted(splitTeamBPr.head.ref);

    await userGithub.waitForPullRequest({
      head: splitTeamAPr.head.ref,
      state: "closed",
    });

    await userGithub.waitForPullRequest({
      head: splitTeamBPr.head.ref,
      state: "closed",
    });

    await userGithub.waitForCommitStatus(
      { ref: managedPr.head.ref },
      {
        context: "rezensent",
        state: "success",
      }
    );
  })
);
