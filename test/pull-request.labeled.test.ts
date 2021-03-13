import { promises as fsp } from "fs";
import { join } from "path";

import { setupApp, context } from "./helper";

jest.setTimeout(1000 * 60 * 15);

test(
  "When a rezensent label is added to a pull request",
  setupApp(async ({ gitClone, octokit, github }) => {
    const label = "Rezensent: Review";
    const branch = "add-label";

    await github.createLabel({
      name: label,
    });
    github.deleteLabelAfterTest(label);

    const { directory, git } = await gitClone();

    await git.createBranch(branch);
    git.deleteBranchAfterTest(branch);
    await fsp.writeFile(join(directory, "a.txt"), "a");
    await git.addAndPushAllChanges(branch, "add a");

    const number = await github.createPullRequest({
      head: branch,
    });
    github.closePullRequestAfterTest(number);

    await octokit.issues.addLabels(
      context.repo({
        issue_number: number,
        labels: [label],
      })
    );

    // todo: expect...
    expect(true).toBeTruthy();
  })
);
