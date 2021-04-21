import type { Probot } from "probot";
import { onAppInstalled, onRepositoriesAdded } from "./event/app-added";
import { onPullRequestClosed } from "./event/closed";
import { onLabelAdded } from "./event/labeled";
import { schedule } from "./event/scheduled";
import { onPullRequestUpdated } from "./event/synchronize";
import { onLabelRemoved } from "./event/unlabeled";

export function app(app: Probot): void {
  app.on("installation.created", onAppInstalled);
  app.on("installation_repositories.added", onRepositoriesAdded);

  app.on("pull_request.closed", onPullRequestClosed);
  app.on("pull_request.labeled", onLabelAdded);
  app.on("pull_request.unlabeled", onLabelRemoved);
  app.on("pull_request.synchronize", onPullRequestUpdated);

  schedule(app).catch((e) => {
    app.log.error(e, "Failed to add scheduler");
  });
}
