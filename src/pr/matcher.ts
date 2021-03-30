import { Context } from "probot";
import { Configuration, getConfig } from "../config";
import { getPullRequest, getPullRequests } from "../github/get";
import { isReferencedPullRequest } from "../github/is-referenced";
import { PullRequest } from "../github/pr";
import { isManagedPullRequest } from "./managed";
import { isReviewPullRequest } from "./review";

export interface PullRequestBase {
  number: PullRequest["number"];
  base: {
    ref: PullRequest["base"]["ref"];
    sha: PullRequest["base"]["sha"];
  };
  head: {
    ref: PullRequest["head"]["ref"];
    sha: PullRequest["head"]["sha"];
  };
}

export interface Managed extends PullRequestBase {
  type: "managed";
  children: Promise<Review[]>;
}

export interface Review extends PullRequestBase {
  type: "review";
  parent: Promise<Managed>;
}

async function parentRequest(
  context: Context,
  review: Review,
  configuration: Configuration
): Promise<Managed> {
  const pullRequests = await getPullRequests(context, {
    params: {
      base: review.base.ref,
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  let managed: Managed;
  let maybeManaged: Managed | undefined = undefined;
  for (const pullRequest of pullRequests) {
    const isReferenced = await isReferencedPullRequest(context, {
      number: pullRequest.number,
      reference: review.number,
    });
    if (isReferenced) {
      maybeManaged = {
        type: "managed",
        ...pullRequest,
        get children() {
          return reviewRequests(context, managed, configuration);
        },
      };
    }
  }
  if (!maybeManaged) {
    throw new Error(
      `[PR-${review.number}] invalid state: no managed parent found`
    );
  }
  managed = maybeManaged;

  return managed;
}

async function reviewRequests(
  context: Context,
  managed: Managed,
  configuration: Configuration
): Promise<Review[]> {
  const pullRequests = await getPullRequests(context, {
    params: {
      base: managed.base.ref,
      state: "open",
    },
    filters: {
      label: configuration.teamReviewLabel,
    },
  });

  const reviewRequests: Review[] = [];
  for (const pullRequest of pullRequests) {
    const isReferenced = await isReferencedPullRequest(context, {
      number: managed.number,
      reference: pullRequest.number,
    });
    if (isReferenced) {
      reviewRequests.push({
        type: "review",
        ...pullRequest,
        get parent() {
          return Promise.resolve(managed);
        },
      });
    }
  }

  return reviewRequests;
}

export function createManaged(
  context: Context,
  pr: PullRequest,
  configuration: Configuration
): Managed {
  const managed: Managed = {
    type: "managed",
    ...pr,
    get children(): Promise<Review[]> {
      return reviewRequests(context, managed, configuration);
    },
  };

  return managed;
}

export function createReview(
  context: Context,
  pr: PullRequest,
  configuration: Configuration
): Review {
  const review: Review = {
    type: "review",
    ...pr,
    get parent(): Promise<Managed> {
      return parentRequest(context, review, configuration);
    },
  };

  return review;
}

export async function match(
  context: Context,
  number: number,
  matcher: {
    managed?(pullRequest: Managed): Promise<void>;
    review?(pullRequest: Review): Promise<void>;
  }
): Promise<void> {
  const pr = await getPullRequest(context, { number });
  const configuration = await getConfig(
    context,
    // if pr is merged, the branch might already be deleted
    // therefore we take the base branch
    pr.merged ? pr.base.ref : pr.head.ref
  );

  const isManaged = await isManagedPullRequest(context, {
    configuration,
    number,
  });
  const isReview = await isReviewPullRequest(context, {
    configuration,
    number,
  });

  if (isManaged && isReview) {
    throw new Error(`[PR-${number}] invalid state: managed & review`);
  }

  if (isManaged) {
    await matcher.managed?.(createManaged(context, pr, configuration));
  } else if (isReview) {
    await matcher.review?.(createReview(context, pr, configuration));
  }
}
