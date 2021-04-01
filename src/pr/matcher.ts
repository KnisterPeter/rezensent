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
  state: PullRequest["state"];
  title: PullRequest["title"];
}

export interface Managed extends PullRequestBase {
  type: "managed";
  children(): Promise<Review[]>;
}

export interface Review extends PullRequestBase {
  type: "review";
  parent(): Promise<Managed>;
}

async function parentRequest(
  context: Context,
  review: Review,
  configuration: Configuration
): Promise<Managed> {
  let managed: Managed;
  let maybeManaged: Managed | undefined = undefined;

  // get all possible candidates
  const pullRequests = await getPullRequests(context, {
    params: {
      state: "open",
    },
    filters: {
      label: configuration.manageReviewLabel,
    },
  });

  for (const pullRequest of pullRequests) {
    const isReferenced = await isReferencedPullRequest(context, {
      number: pullRequest.number,
      reference: review.number,
    });
    if (isReferenced) {
      maybeManaged = createManaged(context, pullRequest, configuration);
      // take first matching candidate
      break;
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

  const numbers = issues.map((item) => (item as any)?.source?.issue?.number);

  const reviewRequests: Review[] = [];
  for (const number of numbers) {
    const pullRequest = await getPullRequest(context, { number });
    const isReview = isReviewPullRequest(context, {
      configuration,
      number: pullRequest.number,
    });
    if (isReview) {
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
