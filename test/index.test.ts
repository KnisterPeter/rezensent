import {
  createEventSource,
  createAuthenticatedOctokit,
  context,
} from "./helper";

test("succeed", async () => {
  const eventSource = createEventSource("abc");
  try {
    const octokit = await createAuthenticatedOctokit();

    const { data: pr } = await octokit.issues.get({
      ...context,
      issue_number: 1,
    });

    const labels = pr.labels.map((label) =>
      typeof label === "string" ? label : label.name
    );

    const hasBugLabel = labels.includes("bug");

    await octokit.issues.removeAllLabels({
      ...context,
      issue_number: 1,
    });
    if (hasBugLabel) {
      await octokit.issues.addLabels({
        ...context,
        issue_number: 1,
        labels: ["discussion"],
      });
    } else {
      await octokit.issues.addLabels({
        ...context,
        issue_number: 1,
        labels: ["bug"],
      });
    }

    expect(true).toBeTruthy();
  } finally {
    eventSource.close();
  }
});
