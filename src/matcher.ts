import { Endpoints } from "@octokit/types";
import { Context } from "probot";
import { Configuration, getConfig } from "./config";
import { ErrorCode, RezensentError } from "./error";
import { findPullRequest, getPullRequest } from "./github/get";
import { isReferencedPullRequest } from "./github/is-referenced";

type PullRequest =
  Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"];

export interface PullRequestBase {
  readonly number: PullRequest["number"];
  readonly base: {
    readonly ref: PullRequest["base"]["ref"];
    readonly sha: PullRequest["base"]["sha"];
  };
  readonly head: {
    readonly ref: PullRequest["head"]["ref"];
    readonly sha: PullRequest["head"]["sha"];
  };
  readonly user: {
    login: string;
  } | null;
  readonly state: PullRequest["state"];
  readonly title: PullRequest["title"];
  readonly body: PullRequest["body"];
  readonly labels: PullRequest["labels"][number]["name"][];
  readonly closed_at: PullRequest["closed_at"];
  readonly merged_at: PullRequest["merged_at"];

  toString(): string;
}

export interface Managed extends PullRequestBase {
  readonly type: "managed";
  children(): Promise<Review[]>;
}

export interface Review extends PullRequestBase {
  readonly type: "review";
  parent(): Promise<Managed>;
}

async function parentRequest(
  context: Context,
  review: Review,
  configuration: Configuration
): Promise<Managed> {
  context.log.debug(`[${review}] search parent`);

  const pullRequest = await findPullRequest(context, {
    params: {
      base: review.base.ref,
      state: "all",
    },
    test: async (pullRequest) => {
      if (review.number === pullRequest.number) {
        return false;
      }
      context.log.debug(
        `[${review}] Check if PR-${pullRequest.number} references ${review}`
      );
      try {
        return isReferencedPullRequest(context, {
          number: pullRequest.number,
          reference: review.number,
        });
      } catch (err) {
        context.log.error(
          err,
          `[${review}] failed to lookup timeline; assume no reference`
        );
        return false;
      }
    },
  });

  if (!pullRequest) {
    throw new RezensentError(
      `[${review}] invalid state: no managed parent found`,
      ErrorCode.no_parent
    );
  }

  return createManaged(context, pullRequest, configuration);
}

async function reviewRequests(
  context: Context,
  managed: Managed,
  configuration: Configuration
): Promise<Review[]> {
  context.log.debug(`[${managed}] search reviews`);

  const items = await context.octokit.paginate(
    context.octokit.issues.listEventsForTimeline,
    context.repo({
      mediaType: {
        previews: ["mockingbird"],
      },
      issue_number: managed.number,
      per_page: 100,
    })
  );

  const crossReferences = items.filter(
    (item) => item.event === "cross-referenced"
  );

  const issues = crossReferences.filter(
    (item) => (item as any)?.source?.type === "issue"
  );

  const numbers: number[] = issues.map(
    (item) => (item as any)?.source?.issue?.number
  );

  const reviewRequests: Review[] = [];
  for (const number of numbers) {
    const { isReview } = await getPullRequestTypes(
      context,
      number,
      configuration
    );
    if (isReview) {
      const pullRequest = await getPullRequest(context, number);
      reviewRequests.push(createReview(context, pullRequest, configuration));
    }
  }

  return reviewRequests;
}

export function createManaged(
  context: Context,
  pr: PullRequestBase,
  configuration: Configuration
): Managed {
  const managed: Managed = {
    type: "managed",

    ...pr,

    children(): Promise<Review[]> {
      return reviewRequests(context, managed, configuration);
    },

    toString() {
      return `PR-${pr.number} (managed)`;
    },
  };

  return managed;
}

export function createReview(
  context: Context,
  pr: PullRequestBase,
  configuration: Configuration
): Review {
  const review: Review = {
    type: "review",

    ...pr,

    parent(): Promise<Managed> {
      return parentRequest(context, review, configuration);
    },

    toString() {
      return `PR-${pr.number} (review)`;
    },
  };

  return review;
}

export async function match(
  context: Context,
  numberOrPullRequest: number | PullRequestBase,
  matcher: {
    managed?(pullRequest: Managed): Promise<void>;
    review?(pullRequest: Review): Promise<void>;
  }
): Promise<void> {
  const pr =
    typeof numberOrPullRequest === "number"
      ? await getPullRequest(context, numberOrPullRequest)
      : numberOrPullRequest;

  // if pr is merged, the branch might already be deleted
  // therefore we take the base branch
  const configBranch = pr.state === "closed" ? pr.base.ref : pr.head.ref;
  context.log.debug(
    { from: pr.state === "closed" ? "base" : "head", branch: configBranch },
    `[PR-${pr.number}] read config`
  );
  const configuration = await getConfig(context, configBranch);

  const { isManaged, isReview } = await getPullRequestTypes(
    context,
    pr,
    configuration
  );

  if (isManaged && isReview) {
    throw new Error(`[PR-${pr.number}] invalid state: managed & review`);
  }

  if (isManaged) {
    await matcher.managed?.(createManaged(context, pr, configuration));
  } else if (isReview) {
    await matcher.review?.(createReview(context, pr, configuration));
  } else {
    context.log.debug(`[PR-${pr.number}] neither managed nor review; ignore`);
  }
}

async function getPullRequestTypes(
  context: Context,
  numberOrPullRequest: number | PullRequestBase,
  configuration: Configuration
): Promise<{
  isManaged: boolean;
  isReview: boolean;
}> {
  const pullRequest =
    typeof numberOrPullRequest === "number"
      ? await getPullRequest(context, numberOrPullRequest)
      : numberOrPullRequest;

  const isManaged = pullRequest.labels.some(
    (label) => label === configuration.manageReviewLabel
  );
  const isReview = pullRequest.labels.some(
    (label) => label === configuration.teamReviewLabel
  );

  context.log.debug(
    { configuration, labels: pullRequest.labels, isManaged, isReview },
    `[PR-${pullRequest.number}] labels`
  );

  return {
    isManaged,
    isReview,
  };
}
