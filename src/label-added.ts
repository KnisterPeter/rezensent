import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";

import { getConfig } from "./get-config";

export async function onLabelAdded(
  context: EventTypesPayload["pull_request.labeled"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  const { name: label } = context.payload.label ?? {};
  const {
    number,
    head: { ref: head, sha: headSha },
  } = context.payload.pull_request;

  const config = await getConfig(head, context);

  if (label !== config.label) {
    context.log.debug(`Ignoring label on PR ${number}`);
    return;
  }

  await context.octokit.repos.createCommitStatus(
    context.repo({
      sha: headSha,
      state: "pending",
      context: "rezensent",
      description: "blocking while in review",
    })
  );

  const { data } = await context.octokit.repos.getContent(
    context.repo({
      ref: head,
      path: ".github/CODEOWNERS",
    })
  );
  if (typeof data !== "object" || !("content" in data)) {
    return;
  }
  const codeowners = Buffer.from(data.content, "base64").toString();

  console.log({ codeowners });
}
