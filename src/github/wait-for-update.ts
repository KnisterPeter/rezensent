import { Context } from "probot";
import { promisify } from "util";

import { PullRequestBase } from "../pr/matcher";

const wait = promisify(setTimeout);

export async function waitForPullRequestUpdate(
  context: Context,
  {
    pullRequest,
  }: {
    pullRequest: PullRequestBase;
  }
): Promise<void> {
  let n = 0;
  while (true) {
    const { data: updatedPullRequest } = await context.octokit.pulls.get(
      context.repo({ pull_number: pullRequest.number })
    );

    if (pullRequest.base.sha !== updatedPullRequest.base.sha) {
      break;
    }

    await wait(4000);

    // give up if we need to wait for too long
    n++;
    if (n >= 10) {
      break;
    }
  }
}
