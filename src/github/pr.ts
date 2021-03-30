import { Endpoints } from "@octokit/types";

export type PullRequest = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];
export type PullRequests = Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"];
