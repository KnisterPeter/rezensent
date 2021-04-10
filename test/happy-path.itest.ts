import { stripIndent } from "common-tags";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ logStep, gitClone, createUserGithub, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //
    const app = await github.getUser();
    const userGithub = await createUserGithub("rezensent-test");

    const managedReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Managed Review (happy path)",
    });

    const teamReviewLabel = await userGithub.createLabel({
      name: "Rezensent: Review Requested (happy path)",
    });

    const { git } = await gitClone(userGithub);

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
    let mainBranchSha = await git.getSha(mainBranch);

    //----------------------------------------
    //
    logStep("Prepare managed pull request");

    const changeBranch = await git.createBranch("some-changes-happy-path");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndCommitChanges("add some files across teams");
    await git.writeFiles({
      "folder-a/c.txt": `c`,
    });
    await git.addAndPushAllChanges(changeBranch, "further changes");

    const managedPrNumber = await userGithub.createPullRequest({
      base: mainBranch,
      head: changeBranch,
      title: "Happy Path Test",
      body: `### :grinning: body

This is just a test body with some markdown in it
`,
    });
    await userGithub.addLabel(managedPrNumber, managedReviewLabel);

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
    logStep("Merge first pr");

    await userGithub.mergePullRequest(splitTeamA);

    await userGithub.waitForPullRequest({
      head: `${changeBranch}-team-a`,
      state: "closed",
      user: app.login,
    });

    mainBranchSha = await git.waitForBranchToBeUpdated(
      mainBranch,
      mainBranchSha
    );

    let managedPr = await userGithub.getPullRequest(managedPrNumber);
    await userGithub.waitForPullRequestBaseToBeUpdated(
      managedPrNumber,
      managedPr.base.sha
    );

    await userGithub.getPullRequest(managedPrNumber);
    let files = await userGithub.getPullRequestFiles(managedPrNumber);
    expect(files).toHaveLength(1);

    //----------------------------------------
    //
    logStep("Merge second pr");

    await userGithub.mergePullRequest(splitTeamB);

    await userGithub.waitForPullRequest({
      head: `${changeBranch}-team-b`,
      state: "closed",
      user: app.login,
    });

    mainBranchSha = await git.waitForBranchToBeUpdated(
      mainBranch,
      mainBranchSha
    );

    managedPr = await userGithub.getPullRequest(managedPrNumber);
    await userGithub.waitForPullRequestBaseToBeUpdated(
      managedPrNumber,
      managedPr.base.sha
    );

    //----------------------------------------
    //
    logStep("Managed pull request should be empty");

    await userGithub.waitForPullRequest({
      head: changeBranch,
      state: "closed",
    });

    files = await userGithub.getPullRequestFiles(managedPrNumber);
    expect(files).toHaveLength(0);
  })
);
