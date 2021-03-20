import { stripIndent } from "common-tags";

import { setupApp, context, Seconds } from "./helper";

jest.setTimeout(1000 * 60 * 15);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ gitClone, testId, user, octokit, github }) => {
    const managedReviewLabel = "Rezensent: Managed-Review";
    const teamReviewLabel = "Rezensent: Team Review Requested";
    const mainBranch = "main-test";
    const changeBranch = "add-label";

    await github.createLabel({
      name: managedReviewLabel,
    });
    github.deleteLabelAfterTest(managedReviewLabel);

    await github.createLabel({
      name: teamReviewLabel,
    });
    github.deleteLabelAfterTest(teamReviewLabel);

    const { git } = await gitClone();

    await git.createBranch(mainBranch);
    git.deleteBranchAfterTest(mainBranch);
    await git.push(mainBranch);

    await git.createBranch(changeBranch);
    git.deleteBranchAfterTest(changeBranch);
    await git.writeFiles({
      ".github/CODEOWNERS": stripIndent`
        folder-a @team-a
        folder-b @team-b
      `,
      ".github/rezensent.yml": stripIndent`
        manage-review-label: "[${testId}] ${managedReviewLabel}"
        team-review-label": "[${testId}] ${teamReviewLabel}"
      `,
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(changeBranch, "add a");

    const number = await github.createPullRequest({
      base: mainBranch,
      head: changeBranch,
    });
    github.closePullRequestAfterTest(number);

    await octokit.issues.addLabels(
      context.repo({
        issue_number: number,
        labels: [`[${testId}] ${managedReviewLabel}`],
      })
    );

    const splitTeamA = await github.waitForPullRequest(
      {
        head: `${changeBranch}-team-a`,
        state: "open",
        user: user.login,
      },
      Seconds.thirty
    );
    git.deleteBranchAfterTest(`${changeBranch}-team-a`);
    github.closePullRequestAfterTest(splitTeamA);

    const splitTeamB = await github.waitForPullRequest(
      {
        head: `${changeBranch}-team-b`,
        state: "open",
        user: user.login,
      },
      Seconds.thirty
    );
    git.deleteBranchAfterTest(`${changeBranch}-team-b`);
    github.closePullRequestAfterTest(splitTeamB);

    await github.mergePullRequest(splitTeamA);

    // todo: wait for the main pr to catch up
    // todo: merge the second splitted pr
    // todo: wait for the main pr to be closed
  })
);
