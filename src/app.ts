import type { Probot } from "probot";

export function app(app: Probot): void {
  app.on("pull_request.labeled", async (context) => {
    context.log(context);
  });
}
