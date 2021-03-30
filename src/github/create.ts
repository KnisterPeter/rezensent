import { Context } from "probot";

export async function createPullRequest(
  context: Context,
  {
    branch,
    title,
    body,
    managedPullRequest: { base },
    label,
  }: {
    branch: string;
    title: string;
    body?: string;
    managedPullRequest: {
      base: string;
      head: string;
      number: number;
    };
    label?: string;
  }
): Promise<number> {
  const {
    data: { number },
  } = await context.octokit.pulls.create(
    context.repo({
      base,
      head: branch,
      title,
      body,
    })
  );

  if (label) {
    await context.octokit.issues.addLabels(
      context.repo({
        issue_number: number,
        labels: [label],
      })
    );
  }

  return number;
}
