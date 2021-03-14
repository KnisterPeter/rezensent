import type { Probot } from "probot";

import { onLabelAdded } from "./label-added";

export function app(app: Probot): void {
  app.on("pull_request.labeled", onLabelAdded);
}
