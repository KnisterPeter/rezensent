import { promisify } from "util";
import { match } from "../matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";
import { schedule, stop } from "./scheduled";

jest.mock("../matcher");
jest.mock("../tasks/queue");
jest.mock("../tasks/synchronize-managed");

const wait = promisify(setTimeout);

test("schedule should start a synchronization task for a found pull request", async () => {
  process.env["SCHEDULE_TIMEOUT"] = "10";

  const octokit = {
    paginate: jest.fn((method) => method()),
    apps: {
      listInstallations: jest.fn().mockResolvedValue([{}]),
      listReposAccessibleToInstallation: jest.fn().mockResolvedValue([
        {
          owner: {
            login: "owner",
          },
        },
      ]),
    },
    pulls: {
      list: jest.fn().mockResolvedValue([
        {
          labels: [],
        },
      ]),
    },
  };

  const app = {
    auth: jest.fn().mockResolvedValue(octokit),
    log: {
      info: jest.fn(),
      warn: jest.fn(),
    },
  };

  (match as jest.MockedFunction<typeof match>).mockImplementation(
    async (_, pr, matcher) => {
      matcher.managed?.(pr as any);
    }
  );

  try {
    schedule(app as any).catch(() => {
      stop();
    });
    // todo: rewrite scheduler to avoid timing issues in tests
    await wait(500);
  } finally {
    stop();
  }

  expect(match).toHaveBeenCalled();
  expect(synchronizeManaged).toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalled();
  expect(app.log.warn).not.toBeCalled();
});
