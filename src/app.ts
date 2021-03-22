import type { Probot } from "probot";

import { onLabelAdded } from "./label-added";
import { onLabelRemoved } from "./label-removed";
import { onPullRequestClosed } from "./pull-request-closed";

export function app(app: Probot): void {
  app.on("pull_request.labeled", onLabelAdded);
  app.on("pull_request.unlabeled", onLabelRemoved);
  app.on("pull_request.closed", onPullRequestClosed);
}
