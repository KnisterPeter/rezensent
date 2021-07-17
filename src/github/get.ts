import type { Endpoints } from "@octokit/types";
import type { WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import type { PullRequestBase } from "../matcher";

export async function getPullRequest(
  context: Context,
  number: number
): Promise<PullRequestBase> {
  const { data: pullRequest } = await context.octokit.pulls.get(
    context.repo({
      pull_number: number,
    })
  );

  return {
    ...pullRequest,
    labels: pullRequest.labels.map((label) => label.name),
  };
}

export async function getPullRequests(
  context: Omit<Context<any>, keyof WebhookEvent<any>>,
  {
    params,
    filters,
  }: {
    params?: Omit<
      Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"],
      "repo" | "owner"
    >;
    filters?: PullRequestFilter;
  }
): Promise<PullRequestBase[]> {
  const list = await context.octokit.paginate(
    context.octokit.pulls.list,
    context.repo({ per_page: 100, ...params })
  );

  let pullRequests = list.map((pullRequest) => ({
    ...pullRequest,
    state: (pullRequest.state === "open" ? "open" : "closed") as
      | "open"
      | "closed",
    labels: pullRequest.labels.map((label) => label.name),
  }));

  if (filters) {
    if (filters.label) {
      pullRequests = pullRequests.filter((pullRequest) =>
        filter(pullRequest, filters)
      );
    }
  }

  return pullRequests;
}

export async function findPullRequest(
  context: Context,
  {
    params,
    filters,
    test,
  }: {
    params?: Omit<
      Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"],
      "repo" | "owner"
    >;
    filters?: PullRequestFilter;
    test?: (pullRequest: PullRequestBase) => Promise<boolean>;
  }
): Promise<PullRequestBase | undefined> {
  for await (const { data: items } of context.octokit.paginate.iterator(
    context.octokit.pulls.list,
    context.repo(params)
  )) {
    for (const item of items) {
      const pullRequest: PullRequestBase = {
        ...item,
        state: (item.state === "open" ? "open" : "closed") as "open" | "closed",
        labels: item.labels.map((label) => label.name),
      };

      const filterResult = filter(pullRequest, filters);
      const testResult = test ? await test(pullRequest) : true;

      if (filterResult && testResult) {
        return pullRequest;
      }
    }
  }

  return undefined;
}

export interface PullRequestFilter {
  label?: string | RegExp;
}

function filter(
  pullRequest: PullRequestBase,
  filter?: PullRequestFilter
): boolean {
  if (!filter) {
    return true;
  }

  const labels = pullRequest.labels.filter((label): label is string =>
    Boolean(label)
  );

  if (typeof filter.label === "string") {
    return labels.includes(filter.label);
  }

  const regexp = filter.label;
  return labels.some((label) => regexp?.test(label));
}
