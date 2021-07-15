import { Configuration, getConfig } from "../../config";
import { Managed, Review } from "../../matcher";
import { handleLabelRemoved } from "./label-removed";
import { closePullRequest } from "../../github/close";
import { unblockPullRequest } from "../../github/commit-status";
import { deleteBranch } from "../../github/git";

jest.mock("../../config");
jest.mock("../../github/close");
jest.mock("../../github/commit-status");
jest.mock("../../github/git");

test("handleLabelRemoved should do nothing if the managed pr still has a managed review label", async () => {
  const config: Configuration = {
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  };
  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue(
    config
  );

  const context = {};
  const managed: Managed = {
    type: "managed",
    number: 0,
    state: "open",
    base: {
      ref: "ref",
      sha: "sha",
    },
    head: {
      ref: "ref",
      sha: "sha",
    },
    title: "title",
    body: "body",
    user: {
      login: "login",
    },
    labels: [config.manageReviewLabel],
    merged_at: "",
    closed_at: "",
    async children() {
      throw new Error("unimplemented");
    },
  };
  const token = {
    abortIfCanceled: jest.fn(),
  };

  const workDone = await handleLabelRemoved(
    context as any,
    managed,
    token as any
  );

  expect(workDone).toBeFalsy();
});

test("handleLabelRemoved should cleanup all created work if managed label was removed", async () => {
  const config: Configuration = {
    manageReviewLabel: "managed",
    teamReviewLabel: "review",
  };
  (getConfig as jest.MockedFunction<typeof getConfig>).mockResolvedValue(
    config
  );

  const context = {
    log: {
      debug: jest.fn(),
    },
  };

  const review: Review = {
    type: "review",
    number: 1,
    state: "open",
    base: {
      ref: "ref",
      sha: "sha",
    },
    head: {
      ref: "review.head.ref",
      sha: "sha",
    },
    title: "title",
    body: "body",
    user: {
      login: "login",
    },
    labels: [],
    merged_at: "",
    closed_at: "",
    parent() {
      throw new Error("unimplemented");
    },
  };
  const managed: Managed = {
    type: "managed",
    number: 0,
    state: "open",
    base: {
      ref: "ref",
      sha: "sha",
    },
    head: {
      ref: "ref",
      sha: "sha",
    },
    title: "title",
    body: "body",
    user: {
      login: "login",
    },
    labels: [],
    merged_at: "",
    closed_at: "",
    async children() {
      return [review];
    },
  };
  const token = {
    abortIfCanceled: jest.fn(),
  };

  const workDone = await handleLabelRemoved(
    context as any,
    managed,
    token as any
  );

  expect(workDone).toBeTruthy();

  expect(closePullRequest).toHaveBeenCalledWith(context, review.number);
  expect(deleteBranch).toHaveBeenCalledWith(context, review.head.ref);
  expect(unblockPullRequest).toHaveBeenCalledWith(context, managed);
});
