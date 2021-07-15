import { Managed } from "../../matcher";
import { updateManaged, UpdateManagedResult } from "./update-managed";

test("updateManaged should return notFound if base branch is not found", async () => {
  const context = {
    log: {
      debug: jest.fn(),
      error: jest.fn(),
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
    labels: [],
    user: {
      login: "login",
    },
    merged_at: "",
    closed_at: "",
    async children() {
      throw new Error("not implemented");
    },
  };
  const token = {
    abortIfCanceled: jest.fn(),
  };

  const result = await updateManaged(context as any, managed, token as any);

  expect(result).toBe(UpdateManagedResult.notFound);
});

test("updateManaged should return upToDate if sha of managed base and and base branch are equal", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      git: {
        getRef: jest
          .fn()
          .mockResolvedValue({ data: { object: { sha: "sha" } } }),
      },
    },
    log: {
      debug: jest.fn(),
      error: jest.fn(),
    },
  };
  const managed: Managed = {
    type: "managed",
    number: 0,
    state: "open",
    base: {
      ref: "managed.base.ref",
      sha: "sha",
    },
    head: {
      ref: "ref",
      sha: "sha",
    },
    title: "title",
    body: "body",
    labels: [],
    user: {
      login: "login",
    },
    merged_at: "",
    closed_at: "",
    async children() {
      throw new Error("not implemented");
    },
  };
  const token = {
    abortIfCanceled: jest.fn(),
  };

  const result = await updateManaged(context as any, managed, token as any);

  expect(result).toBe(UpdateManagedResult.upToDate);
});

test("updateManaged should return updated if sha of managed base and base branch are not equal", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      git: {
        getRef: jest
          .fn()
          .mockResolvedValue({ data: { object: { sha: "other-sha" } } }),
      },
      pulls: {
        updateBranch: jest.fn(),
      },
    },
    log: {
      debug: jest.fn(),
      error: jest.fn(),
    },
  };
  const managed: Managed = {
    type: "managed",
    number: 0,
    state: "open",
    base: {
      ref: "managed.base.ref",
      sha: "sha",
    },
    head: {
      ref: "ref",
      sha: "sha",
    },
    title: "title",
    body: "body",
    labels: [],
    user: {
      login: "login",
    },
    merged_at: "",
    closed_at: "",
    async children() {
      throw new Error("not implemented");
    },
  };
  const token = {
    abortIfCanceled: jest.fn(),
  };

  const result = await updateManaged(context as any, managed, token as any);

  expect(result).toBe(UpdateManagedResult.updated);

  expect(context.octokit.pulls.updateBranch).toBeCalledWith(
    expect.objectContaining({
      pull_number: managed.number,
    })
  );
});
