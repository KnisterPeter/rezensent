import { getConfig } from "./config";
import { getPullRequest, findPullRequest } from "./github/get";
import { isReferencedPullRequest } from "./github/is-referenced";
import { match, createManaged, createReview } from "./matcher";

jest.mock("./config");
jest.mock("./github/get");
jest.mock("./github/is-referenced");

isReferencedPullRequest;

test("match should call the managed callback for a manged pull request", async () => {
  const context = {
    log: {
      debug: jest.fn(),
    },
  };
  const pr = {
    head: {
      ref: "pr.head.ref",
    },
    labels: ["managed"],
  };
  const matcher = {
    managed: jest.fn(),
  };

  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue({
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  });

  await match(context as any, pr as any, matcher);

  expect(getConfig).toHaveBeenCalledWith(context, "pr.head.ref");
  expect(matcher.managed).toHaveBeenCalledWith(expect.objectContaining(pr));
});

test("match should call the review callback for a team review pull request", async () => {
  const context = {
    log: {
      debug: jest.fn(),
    },
  };
  const pr = {
    head: {
      ref: "pr.head.ref",
    },
    labels: ["review"],
  };
  const matcher = {
    review: jest.fn(),
  };

  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue({
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  });

  await match(context as any, pr as any, matcher);

  expect(getConfig).toHaveBeenCalledWith(context, "pr.head.ref");
  expect(matcher.review).toHaveBeenCalledWith(expect.objectContaining(pr));
});

test("match should load the config from base if pull request is already closed", async () => {
  const context = {
    log: {
      debug: jest.fn(),
    },
  };
  const pr = {
    state: "closed",
    base: {
      ref: "pr.base.ref",
    },
    labels: [],
  };
  const matcher = {
    managed: jest.fn(),
  };

  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue({
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  });

  await match(context as any, pr as any, matcher);

  expect(getConfig).toHaveBeenCalledWith(context, "pr.base.ref");
});

test("match should load a pull request if number was given", async () => {
  const context = {
    log: {
      debug: jest.fn(),
    },
  };
  const pr = {
    state: "closed",
    base: {
      ref: "pr.base.ref",
    },
    labels: [],
  };
  const matcher = {
    managed: jest.fn(),
  };

  (
    getPullRequest as jest.MockedFunction<typeof getPullRequest>
  ).mockResolvedValue(pr as any);

  await match(context as any, 0, matcher);

  expect(getPullRequest).toHaveBeenCalledWith(context, 0);
});

test("managed.children should return all created team review requests", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: jest.fn((method) => {
        if (method === context.octokit.issues.listEventsForTimeline) {
          return [
            {
              event: "cross-referenced",
              source: {
                type: "issue",
                issue: {
                  number: 1,
                },
              },
            },
          ];
        }
        throw new Error("not implemented");
      }),
      issues: {
        listEventsForTimeline: jest.fn(),
      },
    },
    log: {
      debug: jest.fn(),
    },
  };
  const config = {
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  };
  const pr0 = {
    number: 0,
    labels: ["managed"],
  };
  const pr1 = {
    number: 1,
    labels: ["review"],
  };

  (
    getPullRequest as jest.MockedFunction<typeof getPullRequest>
  ).mockResolvedValue(pr1 as any);

  const managed = createManaged(context as any, pr0 as any, config);
  const reviews = await managed.children();

  expect(reviews).toEqual([
    expect.objectContaining({
      number: 1,
    }),
  ]);
});

test("review.parent should return the manage pull request", async () => {
  const context = {
    log: {
      debug: jest.fn(),
    },
  };
  const config = {
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  };
  const pr0 = {
    number: 0,
    labels: ["managed"],
  };
  const pr1 = {
    number: 1,
    base: {
      ref: "review.base.ref",
    },
    labels: ["review"],
  };

  // todo: do not mock findPullRequest
  (
    findPullRequest as jest.MockedFunction<typeof findPullRequest>
  ).mockResolvedValue(pr0 as any);

  const review = createReview(context as any, pr1 as any, config);
  const managed = await review.parent();

  expect(managed).toEqual(
    expect.objectContaining({
      number: 0,
    })
  );
});
