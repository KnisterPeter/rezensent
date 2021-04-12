import fastify from "fastify";
import middie from "middie";
import { createNodeMiddleware, createProbot } from "probot";
import { URL } from "url";
import { app } from "./app";
import { stop as stopScheduler } from "./event/scheduled";

export interface Server {
  port: number;
  stop(): Promise<void>;
}

export async function startServer(options?: {
  port?: number;
}): Promise<Server> {
  const probot = createProbot();

  const server = fastify({
    logger: false,
  });
  await server.register(middie);
  await server.use(createNodeMiddleware(app, { probot }));
  const address = await server.listen(
    options?.port ?? Number(process.env["PORT"]),
    "0.0.0.0"
  );

  return {
    port: Number(new URL(address).port),
    async stop() {
      stopScheduler();
      await server.close();
    },
  };
}

if (module.id === ".") {
  startServer();
}
