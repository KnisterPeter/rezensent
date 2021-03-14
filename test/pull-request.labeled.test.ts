import { stripIndent } from "common-tags";

import { setupApp, context, Seconds } from "./helper";

jest.setTimeout(1000 * 60 * 15);

test(
  "Rezensent happy path workflow",
  setupApp(async ({ gitClone, testId, user, octokit, github }) => {
    const label = "Rezensent: Review";
    const branch = "add-label";

    await github.createLabel({
      name: label,
    });
    github.deleteLabelAfterTest(label);

    const { git } = await gitClone();

    // create a pr and add the review label
    await git.createBranch(branch);
    git.deleteBranchAfterTest(branch);
    await git.writeFiles({
      ".github/CODEOWNERS": stripIndent`
        folder-a @KnisterPeter
        folder-b @pr-merger
      `,
      ".github/rezensent.yml": stripIndent`
        label: "[${testId}] ${label}"
      `,
      "folder-a/a.txt": `a`,
      "folder-b/b.txt": `b`,
    });
    await git.addAndPushAllChanges(branch, "add a");

    const number = await github.createPullRequest({
      head: branch,
    });
    github.closePullRequestAfterTest(number);

    await octokit.issues.addLabels(
      context.repo({
        issue_number: number,
        labels: [`[${testId}] ${label}`],
      })
    );

    await github.waitForPullRequest(
      {
        head: `${branch}/team`,
        state: "open",
        user: user.login,
      },
      Seconds.thirty
    );

    // todo: merge one of the splitted prs
    // todo: wait for the main pr to catch up
    // todo: merge the second splitted pr
    // todo: wait for the main pr to be closed
  })
);
