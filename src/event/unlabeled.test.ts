import { getConfig } from "../config";
import { createManaged } from "../matcher";
import { setupBot } from "../setup";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";
import { onLabelRemoved } from "./unlabeled";

jest.mock("../config");
jest.mock("../matcher");
jest.mock("../setup");
jest.mock("../tasks/queue");
jest.mock("../tasks/synchronize-managed");

test("onLabelRemoved should not run if repository is not setup", async () => {
  const context = {
    payload: {
      pull_request: {
        head: {
          ref: "ref",
        },
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(false);

  await onLabelRemoved(context as any);

  expect(createManaged).not.toHaveBeenCalled();
});

test("onLabelRemoved should do nothing if a label was removed which is not configured as managed label", async () => {
  const context = {
    payload: {
      pull_request: {
        head: {
          ref: "ref",
        },
      },
      label: {
        name: "label",
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue({
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  });

  await onLabelRemoved(context as any);

  expect(synchronizeManaged).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});

test("onLabelRemoved should enqueue a synchronize-managed task", async () => {
  const context = {
    payload: {
      pull_request: {
        head: {
          ref: "ref",
        },
        labels: [],
      },
      label: {
        name: "managed",
      },
    },
    log: {
      debug: jest.fn(),
    },
  };

  (setupBot as jest.MockedFunction<typeof setupBot>).mockResolvedValue(true);
  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue({
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  });

  const managed = {};
  (createManaged as jest.MockedFunction<typeof createManaged>).mockReturnValue(
    managed as any
  );

  await onLabelRemoved(context as any);

  expect(synchronizeManaged).toHaveBeenCalledWith(context, managed);
  expect(enqueue).toHaveBeenCalled();
});
