import { match } from "../matcher";
import { setupBot } from "../setup";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";
import { synchronizeReview } from "../tasks/synchronize-review";
import { onPullRequestUpdated } from "./synchronize";

jest.mock("../matcher");
jest.mock("../github/commit-status");
jest.mock("../setup");
jest.mock("../tasks/queue");
jest.mock("../tasks/synchronize-managed");
jest.mock("../tasks/synchronize-review");

test("onPullRequestUpdated should not run if repository is not setup", async () => {
  const context = {
    payload: {
      pull_request: {},
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(false);

  await onPullRequestUpdated(context as any);

  expect(enqueue).not.toHaveBeenCalled();
  expect(synchronizeManaged).not.toHaveBeenCalled();
  expect(synchronizeReview).not.toHaveBeenCalled();
});

test("onPullRequestUpdated should not run if pull request is merged", async () => {
  const context = {
    payload: {
      pull_request: {
        merged: true,
      },
    },
  };

  await onPullRequestUpdated(context as any);

  expect(enqueue).not.toHaveBeenCalled();
  expect(synchronizeManaged).not.toHaveBeenCalled();
  expect(synchronizeReview).not.toHaveBeenCalled();
});

test("onPullRequestUpdated should schedule synchronize task on managed pull requests", async () => {
  const context = {
    payload: {
      pull_request: {
        base: {
          ref: "pr.base.ref",
        },
        labels: [],
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (match as jest.MockedFunction<typeof match>).mockImplementation(
    async (_, pr, matcher) => {
      matcher.managed?.(pr as any);
    }
  );

  await onPullRequestUpdated(context as any);

  expect(enqueue).toHaveBeenCalled();
  expect(synchronizeManaged).toHaveBeenCalled();
});

test("onPullRequestUpdated should schedule synchronize task on review pull requests", async () => {
  const context = {
    payload: {
      pull_request: {
        base: {
          ref: "pr.base.ref",
        },
        labels: [],
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (match as jest.MockedFunction<typeof match>).mockImplementation(
    async (_, pr, matcher) => {
      matcher.review?.(pr as any);
    }
  );

  await onPullRequestUpdated(context as any);

  expect(enqueue).toHaveBeenCalled();
  expect(synchronizeReview).toHaveBeenCalled();
});
