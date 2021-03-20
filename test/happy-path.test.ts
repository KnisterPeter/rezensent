import { stripIndent } from "common-tags";

import { setupApp, context } from "./helper";

jest.setTimeout(1000 * 60 * 15);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ gitClone, user, octokit, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //

    const managedReviewLabel = await github.createLabel({
      name: "Rezensent: Managed Review",
    });
    github.deleteLabelAfterTest(managedReviewLabel);

    const teamReviewLabel = await github.createLabel({
      name: "Rezensent: Review Requested",
    });
    github.deleteLabelAfterTest(teamReviewLabel);

    const { git } = await gitClone();

    //----------------------------------------
    // setup repo (branches, ...)
    //

    const mainBranch = await git.createBranch("main-test");
    git.deleteBranchAfterTest(mainBranch);
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
    // prepare review pull request
    //

    const changeBranch = await git.createBranch("add-label");
    git.deleteBranchAfterTest(changeBranch);
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add a");

    const number = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
    });
    github.closePullRequestAfterTest(number);

    // todo: add helper
    await octokit.issues.addLabels(
      context.repo({
        issue_number: number,
        labels: [managedReviewLabel],
      })
    );

    //----------------------------------------
    // wait for bot to work
    //

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

    //----------------------------------------
    // merge first pr
    //

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

    await github.waitForPullRequestToBeRebased(number, mainBranchSha);

    //----------------------------------------
    // merge second pr
    //

    await github.mergePullRequest(splitTeamB);

    await github.waitForPullRequest({
      head: `${changeBranch}-team-b`,
      state: "closed",
      user: user.login,
    });

    mainBranchSha = await git.waitForBranchToBeUpdated(
      mainBranch,
      mainBranchSha
    );
    await github.waitForPullRequestToBeRebased(number, mainBranchSha);
  })
);
