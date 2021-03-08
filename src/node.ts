import fastify from "fastify";
import middie from "middie";
import { createNodeMiddleware, createProbot, ProbotOctokit } from "probot";
import { URL } from "url";

import { app } from "./app";

export interface Server {
  port: number;
  octokit: typeof ProbotOctokit;
  stop(): Promise<void>;
}

export async function startServer(options?: {
  port?: number;
}): Promise<Server> {
  const probot = createProbot();

  const server = fastify({
    logger: process.env["LOG_LEVEL"] ? { prettyPrint: true } : false,
  });
  await server.register(middie);
  await server.use(createNodeMiddleware(app, { probot }));
  const address = await server.listen(
    options?.port ?? Number(process.env["PORT"])
  );

  return {
    port: Number(new URL(address).port),
    octokit: undefined as never,
    async stop() {
      await server.close();
    },
  };
}

if (module.id === ".") {
  startServer();
}
