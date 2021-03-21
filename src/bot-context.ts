import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import { Context, ProbotOctokit } from "probot";

export interface BotContext {
  octokit: InstanceType<typeof ProbotOctokit>;
  repo: Context["repo"];
  log: Context["log"];
}

export function createBotContext(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
): BotContext {
  return {
    octokit: context.octokit,
    repo: context.repo.bind(context),
    log: context.log,
  };
}
