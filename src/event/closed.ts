import type { EventTypesPayload, WebhookEvent } from "@octokit/webhooks";
import type { Context } from "probot";
import { promisify } from "util";
import { ErrorCode, RezensentError } from "../error";
import { match, PullRequestBase } from "../matcher";
import { setupBot } from "../setup";
import { enqueue } from "../tasks/queue";
import { synchronizeManaged } from "../tasks/synchronize-managed";

const wait = promisify(setTimeout);

export async function onPullRequestClosed(
  context: EventTypesPayload["pull_request.merged"] &
    Omit<Context<any>, keyof WebhookEvent<any>>
) {
  if (!(await setupBot(context))) {
    return;
  }

  const { number, merged, state, labels } = context.payload.pull_request;

  context.log.debug(`[PR-${number}] was ${merged ? "merged" : "closed"}`);

  const pullRequest: PullRequestBase = {
    ...context.payload.pull_request,
    state: state === "open" ? "open" : "closed",
    labels: labels.map((label) => label.name),
  };

  await match(context, pullRequest, {
    async review(review) {
      const handleClose = async () => {
        const managed = await review.parent();
        enqueue(
          context,
          `close ${review}`,
          synchronizeManaged(context, managed)
        );
      };

      try {
        await handleClose();
      } catch (err) {
        RezensentError.assertInstance(err);
        if (err.code === ErrorCode.no_parent) {
          // let github catch-up then retry
          await wait(1000 * 10);
          await handleClose();
        }
      }
    },
  });
}
