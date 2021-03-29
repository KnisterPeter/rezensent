import { stripIndent } from "common-tags";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ logStep, gitClone, user, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //

    const managedReviewLabel = await github.createLabel({
      name: "Rezensent: Managed Review (happy path)",
    });

    const teamReviewLabel = await github.createLabel({
      name: "Rezensent: Review Requested (happy path)",
    });

    const { git } = await gitClone();

    //----------------------------------------
    //
    logStep("Setup repo (branches, ...)");

    const mainBranch = await git.createBranch("main-test-happy-path");
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
    await git.addAndPushAllChanges(mainBranch, "setup main branch");

    await git.fetch();
    let mainBranchSha = await git.getSha(mainBranch);

    //----------------------------------------
    //
    logStep("Prepare managed pull request");

    const changeBranch = await git.createBranch("some-changes-happy-path");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const managedPrNumber = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Happy Path Test",
    });
    await github.addLabel(managedPrNumber, managedReviewLabel);
    let managedPr = await github.getPullRequest(managedPrNumber);

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
    logStep("Merge first pr");

    await github.mergePullRequest(splitTeamA);

    await github.waitForPullRequest({
      head: `${changeBranch}-team-a`,
      state: "closed",
      user: user.login,
    });

    mainBranchSha = await git.waitForBranchToBeUpdated(
      mainBranch,
      mainBranchSha
    );

    await github.waitForPullRequestBaseToBeUpdated(
      managedPrNumber,
      managedPr.base.sha
    );
    managedPr = await github.getPullRequest(managedPrNumber);

    let files = await github.getPullRequestFiles(managedPrNumber);
    expect(files).toHaveLength(1);

    //----------------------------------------
    //
    logStep("Merge second pr");

    await github.mergePullRequest(splitTeamB);

    await github.waitForPullRequest({
      head: `${changeBranch}-team-b`,
      state: "closed",
      user: user.login,
    });

    await github.waitForPullRequestBaseToBeUpdated(
      managedPrNumber,
      managedPr.base.sha
    );

    //----------------------------------------
    //
    logStep("Managed pull request should be empty");

    await github.waitForPullRequest({
      head: changeBranch,
      state: "closed",
    });

    files = await github.getPullRequestFiles(managedPrNumber);
    expect(files).toHaveLength(0);
  })
);
