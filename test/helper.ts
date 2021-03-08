import { config as dotEnvConfig } from "dotenv";
import { ProbotOctokit } from "probot";
import type EventSource from "eventsource";
import SmeeClient from "smee-client";

import { startServer, Server } from "../src/node";

beforeAll(() => {
  dotEnvConfig();
});

let server: Server;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.stop();
});

let smee: EventSource;

afterAll(() => {
  smee?.close();
});

function has<K extends string>(o: object, key: K): o is Record<K, unknown> {
  return key in o;
}

class ExtendedSmeeClient extends SmeeClient {
  #testId: string;

  constructor({
    ...options
  }: ConstructorParameters<typeof SmeeClient>[0] & { testId: string }) {
    super(options);
    this.#testId = options.testId;
  }

  onmessage(msg: unknown) {
    if (
      typeof msg === "object" &&
      msg !== null &&
      has(msg, "data") &&
      typeof msg.data === "string"
    ) {
      const data = JSON.parse(msg.data);
      if (has(data, "x-github-event")) {
        switch (data["x-github-event"]) {
          case "pull_request":
            return super.onmessage(msg);
        }

        throw new Error(
          `Received invalid webhook message: '${data["x-github-event"]}'`
        );
      }
    }

    throw new Error("Received invalid webhook message");
  }
}

export function createEventSource(testId: string): EventSource {
  if (!smee) {
    if (!process.env["WEBHOOK_PROXY_URL"]) {
      throw new Error("Required 'WEBHOOK_PROXY_URL' missing");
    }

    smee = new ExtendedSmeeClient({
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
      source: process.env["WEBHOOK_PROXY_URL"],
      target: `http://localhost:${server.port}`,
      testId,
    }).start();
  }
  return smee;
}

export async function createAuthenticatedOctokit(): Promise<
  InstanceType<typeof ProbotOctokit>
> {
  if (!process.env["APP_ID"] || !process.env["PRIVATE_KEY"]) {
    throw new Error("Required 'APP_ID' or 'PRIVATE_KEY' missing");
  }

  const appOctokit = new ProbotOctokit({
    auth: {
      appId: Number(process.env["APP_ID"]),
      privateKey: process.env["PRIVATE_KEY"],
    },
  });

  const { data: installations } = await appOctokit.apps.listInstallations();

  if (!installations[0]) {
    throw new Error("No installation found");
  }

  const {
    data: accessToken,
  } = await appOctokit.apps.createInstallationAccessToken({
    installation_id: installations[0].id,
  });

  return new ProbotOctokit({
    auth: { token: accessToken.token },
  });
}

export const context = {
  owner: "KnisterPeter",
  repo: "rezensent-test",
};
