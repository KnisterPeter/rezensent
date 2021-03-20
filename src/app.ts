import type { Probot } from "probot";

import { onLabelAdded } from "./label-added";
import { onPullRequestMerged } from "./pull-request-merged";

export function app(app: Probot): void {
  app.on("pull_request.labeled", onLabelAdded);
  app.on("pull_request.merged", onPullRequestMerged);
}
