import type { Probot, WebhookPayloadWithRepository } from "probot";
import { Context } from "probot";
import { promisify } from "util";
import { match, PullRequestBase } from "../matcher";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

const wait = promisify(setTimeout);
let running = true;

export function stop(): void {
  running = false;
}

async function waitUntil(date: number): Promise<void> {
  while (true) {
    if (Date.now() >= date) {
      break;
    }
    await wait(1000);
  }
}

export async function schedule(app: Probot): Promise<void> {
  // default: no delay at startup
  const delay = Number(process.env["SCHEDULE_DELAY"] ?? "0");
  // default: run every 30 minutes
  const timeout = Number(
    process.env["SCHEDULE_TIMEOUT"] ?? String(1000 * 60 * 30)
  );
  app.log.info({ delay, timeout }, "Scheduler");

  if (timeout < 0) {
    return;
  }

  await waitUntil(Date.now() + delay);

  while (running) {
    const next = Date.now() + timeout;

    await runScheduled(app);
    await waitUntil(next);
  }
}

async function runScheduled(app: Probot): Promise<void> {
  const appOctokit = await app.auth();

  const installations = await appOctokit.paginate(
    appOctokit.apps.listInstallations,
    { per_page: 100 }
  );

  for (const installation of installations) {
    if (!running) {
      break;
    }

    const octokit = await app.auth(installation.id);

    const repositories = await octokit.paginate(
      octokit.apps.listReposAccessibleToInstallation,
      { per_page: 100 }
    );

    for (const repository of repositories) {
      if (!running) {
        break;
      }

      const context = new Context<WebhookPayloadWithRepository>(
        {
          id: `event.scheduled.${repository.id}`,
          name: "scheduled" as any,
          payload: {
            repository: {
              ...repository,
              mirror_url: null,
            },
          },
        },
        octokit,
        app.log
      );

      await onScheduled(context);
    }
  }
}

async function onScheduled(context: Context<any>) {
  const prs = await context.octokit.paginate(
    context.octokit.pulls.list,
    context.repo({
      state: "open" as const,
      per_page: 100,
    })
  );

  for (const pr of prs) {
    if (!running) {
      break;
    }

    const pullRequest: PullRequestBase = {
      ...pr,
      state: pr.state as "open" | "closed",
      labels: pr.labels.map((label) => label.name),
    };

    await match(context, pullRequest, {
      async managed(managed) {
        enqueue(
          context,
          `scheduled update of ${managed}`,
          synchronizeManaged(context, managed)
        );
      },
    });
  }
}
