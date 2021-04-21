import { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { setupBot } from "../setup";

export async function onAppInstalled(
  probotContext: EventTypesPayload["installation.created"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  for (const repository of probotContext.payload.repositories) {
    await setupRepository(
      probotContext,
      probotContext.payload.installation.account.login,
      repository.name
    );
  }
}

export async function onRepositoriesAdded(
  probotContext: EventTypesPayload["installation_repositories.added"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  if (probotContext.payload.repository_selection === "selected") {
    for (const repository of probotContext.payload.repositories_added) {
      await setupRepository(
        probotContext,
        probotContext.payload.installation.account.login,
        repository.name
      );
    }
  } else {
    const repositories = await probotContext.octokit.paginate(
      probotContext.octokit.apps.listReposAccessibleToInstallation
    );
    for (const repository of repositories) {
      await setupRepository(
        probotContext,
        probotContext.payload.installation.account.login,
        repository.name
      );
    }
  }
}

async function setupRepository(
  probotContext: Omit<Context<any>, keyof WebhookEvent<any>>,
  owner: string,
  repo: string
): Promise<void> {
  // For this payload `context.repo` is not available in probot,
  // so we create our own wrapper
  const context = {
    ...probotContext,
    repo: <T>(object: T) => ({
      owner,
      repo,
      ...object,
    }),
  };

  try {
    await setupBot(context);
  } catch (e) {
    context.log.error(e, `Failed to setup repository ${owner}/${repo}`);
  }
}
