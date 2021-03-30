import { Context } from "probot";

export async function isReferencedPullRequest(
  context: Context,
  {
    number,
    reference,
  }: {
    number: number;
    reference: number;
  }
): Promise<boolean> {
  const items = await context.octokit.paginate(
    context.octokit.issues.listEventsForTimeline,
    context.repo({
      mediaType: {
        previews: ["mockingbird"],
      },
      issue_number: number,
      per_page: 100,
    })
  );

  const crossReferences = items.filter(
    (item) => item.event === "cross-referenced"
  );

  const issues = crossReferences.filter(
    (item) => (item as any).source.type === "issue"
  );

  return issues.some((item) => (item as any).source.issue.number === reference);
}
