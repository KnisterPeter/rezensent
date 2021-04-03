import type { Probot } from "probot";
import { onAppAdded } from "./event/app-added";
import { onPullRequestClosed } from "./event/closed";
import { onLabelAdded } from "./event/labeled";
import { onPullRequestUpdated } from "./event/synchronize";
import { onLabelRemoved } from "./event/unlabeled";

export function app(app: Probot): void {
  app.on("installation_repositories.added", onAppAdded);

  app.on("pull_request.closed", onPullRequestClosed);
  app.on("pull_request.labeled", onLabelAdded);
  app.on("pull_request.unlabeled", onLabelRemoved);
  app.on("pull_request.synchronize", onPullRequestUpdated);
}
