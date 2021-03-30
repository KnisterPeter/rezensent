import { Endpoints } from "@octokit/types";

export type PullRequest = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][number];
