import { onLabelAdded } from "./labeled";
import { match } from "../matcher";
import { setupBot } from "../setup";
import { blockPullRequest } from "../github/commit-status";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

jest.mock("../setup");
jest.mock("../matcher");
jest.mock("../github/commit-status");
jest.mock("../tasks/queue");
jest.mock("../tasks/synchronize-managed");

test("onLabelAdded should stop processing of repo is not setup", async () => {
  const context = {
    payload: {
      label: {
        name: "added-label",
      },
      pull_request: {
        number: 1,
        state: "open",
        labels: [],
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(false);

  await onLabelAdded(context as any);

  expect(match).not.toHaveBeenCalled();
});

test("onLabelAdded should block managed pull request and enqueue synchronize task", async () => {
  const managedPullRequest = {};
  const context = {
    payload: {
      label: {
        name: "added-label",
      },
      pull_request: {
        number: 1,
        state: "open",
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
      options.managed?.(managedPullRequest as any);
    }
  );

  await onLabelAdded(context as any);

  expect(match).toHaveBeenCalledWith(
    context,
    {
      number: 1,
      state: "open",
      labels: [],
    },
    expect.any(Object)
  );

  expect(blockPullRequest).toHaveBeenCalledWith(context, managedPullRequest);
  expect(synchronizeManaged).toHaveBeenCalledWith(context, managedPullRequest);
  expect(enqueue).toHaveBeenCalled();
});

test("onLabelAdded should ignore review requests", async () => {
  const context = {
    payload: {
      label: {
        name: "added-label",
      },
      pull_request: {
        number: 1,
        state: "open",
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
      expect(options.review).toBeUndefined();
    }
  );

  await onLabelAdded(context as any);

  expect.assertions(1);
});
