import { onPullRequestClosed } from "./closed";
import { setupBot } from "../setup";
import { match } from "../matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

jest.mock("../setup");
jest.mock("../matcher");
jest.mock("../tasks/queue");
jest.mock("../tasks/synchronize-managed");

test("onPullRequestClosed should not run if repository is not setup", async () => {
  const context = {
    payload: {
      pull_request: {},
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(false);

  await onPullRequestClosed(context as any);

  expect(match).not.toHaveBeenCalled();
});

test("onPullRequestClosed should ignore managed pull requests", async () => {
  const context = {
    payload: {
      pull_request: {
        labels: [],
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (match as jest.MockedFunction<typeof match>).mockImplementation(
    async (_, __, options) => {
      expect(options.managed).toBeUndefined();
    }
  );

  await onPullRequestClosed(context as any);

  expect.assertions(1);
});

test("onPullRequestClosed should enqueue a synchronize task on a review request", async () => {
  const parent = {};
  const reviewPullRequest = {
    parent: jest.fn().mockReturnValue(parent),
  };

  const context = {
    payload: {
      pull_request: {
        labels: [],
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (match as jest.MockedFunction<typeof match>).mockImplementation(
    async (_, __, options) => {
      options.review?.(reviewPullRequest as any);
    }
  );

  await onPullRequestClosed(context as any);

  expect(reviewPullRequest.parent).toHaveBeenCalled();
  expect(synchronizeManaged).toHaveBeenCalledWith(context, parent);
  expect(enqueue).toHaveBeenCalled();
});
