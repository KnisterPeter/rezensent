import type { Probot } from "probot";

import { onPullRequestClosed } from "./event/closed";
import { onLabelAdded } from "./event/labeled";
import { onLabelRemoved } from "./event/unlabeled";
import { onPullRequestUpdated } from "./event/synchronize";

export function app(app: Probot): void {
  app.on("pull_request.closed", onPullRequestClosed);
  app.on("pull_request.labeled", onLabelAdded);
  app.on("pull_request.unlabeled", onLabelRemoved);
  app.on("pull_request.synchronize", onPullRequestUpdated);
}
