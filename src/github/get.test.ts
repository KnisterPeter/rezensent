import { findPullRequest, getPullRequest, getPullRequests } from "./get";

test("getPullRequest should load a pull request and convert it's labels", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      pulls: {
        get: jest.fn().mockResolvedValue({
          data: {
            number: 0,
            labels: [{ name: "test" }],
          },
        }),
      },
    },
  };

  const pr = await getPullRequest(context as any, 0);

  expect(pr.number).toBe(0);
  expect(pr.labels).toEqual(expect.arrayContaining(["test"]));
});

test("getPullRequests should return a list of matching pull requests", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: jest.fn((method) => method()),
      pulls: {
        list: jest.fn().mockResolvedValue([
          {
            labels: [],
          },
          {
            labels: [],
          },
        ]),
      },
    },
  };

  const prs = await getPullRequests(context as any, {
    params: {
      state: "open",
    },
  });

  expect(context.octokit.paginate).toHaveBeenCalledWith(
    context.octokit.pulls.list,
    expect.objectContaining({
      state: "open",
    })
  );
  expect(prs).toHaveLength(2);
});

test("getPullRequests should return a list of filtered pull requests", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: jest.fn((method) => method()),
      pulls: {
        list: jest.fn().mockResolvedValue([
          {
            labels: [],
          },
          {
            state: "open",
            labels: [
              {
                name: "test",
              },
            ],
          },
        ]),
      },
    },
  };

  const prs = await getPullRequests(context as any, {
    params: {
      state: "open",
    },
    filters: {
      label: "test",
    },
  });

  expect(context.octokit.paginate).toHaveBeenCalledWith(
    context.octokit.pulls.list,
    expect.objectContaining({
      state: "open",
    })
  );
  expect(prs).toHaveLength(1);
  expect(prs[0]?.labels).toEqual(["test"]);
});

test("findPullRequest should return the first matching pull request", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: {
        iterator: jest.fn(() => {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                data: [
                  {
                    labels: [],
                  },
                ],
              };
            },
          };
        }),
      },
      pulls: {
        list: jest.fn(),
      },
    },
  };

  const pr = await findPullRequest(context as any, {
    params: {
      state: "open",
    },
  });

  expect(context.octokit.paginate.iterator).toHaveBeenCalledWith(
    context.octokit.pulls.list,
    expect.objectContaining({
      state: "open",
    })
  );
  expect(pr).toBeDefined();
});

test("findPullRequest should return the first matching and filtered pull request", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: {
        iterator: jest.fn(() => {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                data: [
                  {
                    labels: [],
                  },
                ],
              };
              yield {
                data: [
                  {
                    state: "open",
                    labels: [{ name: "test" }],
                  },
                ],
              };
            },
          };
        }),
      },
      pulls: {
        list: jest.fn(),
      },
    },
  };

  const pr = await findPullRequest(context as any, {
    params: {
      state: "open",
    },
    filters: {
      label: /test/,
    },
  });

  expect(context.octokit.paginate.iterator).toHaveBeenCalledWith(
    context.octokit.pulls.list,
    expect.objectContaining({
      state: "open",
    })
  );
  expect(pr?.labels).toEqual(["test"]);
});

test("findPullRequest should return a pull request matching the custom test function", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: {
        iterator: jest.fn(() => {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                data: [
                  {
                    labels: [],
                  },
                ],
              };
              yield {
                data: [
                  {
                    title: "title",
                    labels: [],
                  },
                ],
              };
            },
          };
        }),
      },
      pulls: {
        list: jest.fn(),
      },
    },
  };

  const pr = await findPullRequest(context as any, {
    params: {
      state: "open",
    },
    test: async (pr) => pr.title === "title",
  });

  expect(context.octokit.paginate.iterator).toHaveBeenCalledWith(
    context.octokit.pulls.list,
    expect.objectContaining({
      state: "open",
    })
  );
  expect(pr?.title).toBe("title");
});

test("findPullRequest should return undefined, if no match was found", async () => {
  const context = {
    repo: jest.fn((o) => o),
    octokit: {
      paginate: {
        iterator: jest.fn(() => {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                data: [
                  {
                    labels: [],
                  },
                  {
                    title: "title",
                    labels: [],
                  },
                ],
              };
            },
          };
        }),
      },
      pulls: {
        list: jest.fn(),
      },
    },
  };

  const pr = await findPullRequest(context as any, {
    test: async () => false,
  });

  expect(pr).toBeUndefined();
});
