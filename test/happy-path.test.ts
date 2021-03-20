import { stripIndent } from "common-tags";

import { setupApp, Minutes } from "./helper";

jest.setTimeout(Minutes.fifteen);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ gitClone, user, github }) => {
    //----------------------------------------
    // setup bot (labels, ...)
    //

    const managedReviewLabel = await github.createLabel({
      name: "Rezensent: Managed Review",
    });

    const teamReviewLabel = await github.createLabel({
      name: "Rezensent: Review Requested",
    });

    const { git } = await gitClone();

    //----------------------------------------
    // setup repo (branches, ...)
    //

    const mainBranch = await git.createBranch("main-test");
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

    const changeBranch = await git.createBranch("some-changes");
    await git.writeFiles({
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add some files across teams");

    const number = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
    });
    await github.addLabel(number, managedReviewLabel);

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

    github.closePullRequestAfterTest(splitTeamA);
    github.closePullRequestAfterTest(splitTeamB);
    git.deleteBranchAfterTest(`${changeBranch}-team-a`);
    git.deleteBranchAfterTest(`${changeBranch}-team-b`);

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
  })
);
