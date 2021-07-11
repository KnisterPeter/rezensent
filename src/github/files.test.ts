import {
  getMapOfChangedFilesPerTeam,
  getPullRequestFiles,
  getFile,
} from "./files";

test("getPullRequestFiles should return all files changed in a pull request", async () => {
  const repo = {};
  const changedFiles = ["changed.txt", "path/changed.txt"];

  const context = {
    octokit: {
      paginate: jest.fn().mockReturnValue(changedFiles),
      pulls: {
        listFiles: jest.fn(),
      },
    },
    repo: jest.fn().mockReturnValue(repo),
  };

  const files = await getPullRequestFiles(context as any, { number: 1 });

  expect(context.repo).toHaveBeenCalledWith({
    pull_number: 1,
    per_page: 100,
  });

  expect(context.octokit.paginate).toHaveBeenCalledWith(
    context.octokit.pulls.listFiles,
    repo,
    expect.any(Function)
  );

  expect(files).toEqual(changedFiles);
});

test("getFile should return the content of the given file from github", async () => {
  const content = "content";
  const repo = {};

  const context = {
    octokit: {
      repos: {
        getContent: jest.fn().mockReturnValue({
          data: {
            content: Buffer.from(content).toString("base64"),
          },
        }),
      },
    },
    repo: jest.fn().mockReturnValue(repo),
  };

  const result = await getFile(context as any, {
    branch: "branch",
    path: "path/to/file",
  });

  expect(context.repo).toHaveBeenCalledWith({
    ref: "branch",
    path: "path/to/file",
  });

  expect(result).toBe(content);
});

test("getFile should return empty string if no content found", async () => {
  const repo = {};

  const context = {
    octokit: {
      repos: {
        getContent: jest.fn().mockReturnValue({
          data: {},
        }),
      },
    },
    repo: jest.fn().mockReturnValue(repo),
  };

  const result = await getFile(context as any, {
    branch: "branch",
    path: "path/to/file",
  });

  expect(context.repo).toHaveBeenCalledWith({
    ref: "branch",
    path: "path/to/file",
  });

  expect(result).toBe("");
});

test("getFile should throw on unknown files/paths", async () => {
  const repo = {};

  const context = {
    octokit: {
      repos: {
        getContent: jest.fn().mockImplementation(() => {
          throw new Error("404");
        }),
      },
    },
    repo: jest.fn().mockReturnValue(repo),
  };

  expect(
    getFile(context as any, {
      branch: "branch",
      path: "path/to/file",
    })
  ).rejects.toThrow("File 'path/to/file' not found");
});

test("getMapOfChangedFilesPerTeam should sort the changed files in buckets according to the patterns", () => {
  const changedFiles = ["changed.txt", "path/changed.txt", "path/other.txt"];

  const buckets = getMapOfChangedFilesPerTeam({
    changedFiles,
    patterns: new Map([
      ["team-a", ["^changed.txt$"]],
      ["team-b", ["^path/.*$"]],
    ]),
  });

  expect(buckets).toEqual(
    new Map([
      ["team-a", ["changed.txt"]],
      ["team-b", ["path/changed.txt", "path/other.txt"]],
    ])
  );
});
