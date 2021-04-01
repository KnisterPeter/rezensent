import { Endpoints } from "@octokit/types";
import { Context } from "probot";

import { PullRequest, PullRequests } from "./pr";

export async function getPullRequest(
  context: Context,
  number: number
): Promise<PullRequest> {
  const { data: pullRequest } = await context.octokit.pulls.get(
    context.repo({
      pull_number: number,
    })
  );

  return pullRequest;
}

export async function getPullRequests(
  context: Context,
  {
    params,
    filters,
  }: {
    params?: Omit<
      Endpoints["GET /repos/{owner}/{repo}/pulls"]["parameters"],
      "repo" | "owner"
    >;
    filters?: {
      label?: string | RegExp;
    };
  }
): Promise<PullRequests> {
  let pullRequests = await context.octokit.paginate(
    context.octokit.pulls.list,
    context.repo({ per_page: 100, ...params })
  );

  if (filters) {
    if (filters.label) {
      const test = filters.label;
      pullRequests = pullRequests.filter((pullRequest) => {
        const labels = pullRequest.labels
          .map((label) => label.name)
          .filter((label): label is string => Boolean(label));
        return typeof test === "string"
          ? labels.includes(test)
          : labels.some((label) => test.test(label));
      });
    }
  }

  return pullRequests as PullRequests;
}
