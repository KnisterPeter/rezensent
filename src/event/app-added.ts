import { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { setupBot } from "../setup";

export async function onAppAdded(
  probotContext: EventTypesPayload["installation_repositories.added"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  for (const repository of probotContext.payload.repositories_added) {
    // For this payload `context.repo` is not available in probot,
    // so we create our own wrapper
    const context = {
      ...probotContext,
      repo: <T>(object: T) => ({
        owner: context.payload.installation.account.login,
        repo: repository.name,
        ...object,
      }),
    };

    await setupBot(context);
  }
}
