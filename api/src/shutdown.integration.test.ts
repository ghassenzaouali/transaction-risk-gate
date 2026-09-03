import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";

// SIGTERM n'est pas émulé sur Windows (process.kill le transforme en arrêt
// brutal). Ce test tourne en CI et dans le conteneur, où l'arrêt gracieux compte.
const skip = process.platform === "win32" ? "SIGTERM non émulé sur Windows" : false;

const childEnv = {
  ...process.env,
  API_KEY: randomBytes(32).toString("hex"),
  REDIS_URL: "redis://127.0.0.1:6379",
  REDIS_HMAC_SECRET: randomBytes(32).toString("hex"),
  AMOUNT_THRESHOLD: "1000",
  VELOCITY_MAX: "3",
  VELOCITY_WINDOW_SECONDS: "60",
  ALLOWED_COUNTRIES: "FR",
  HIGH_RISK_MERCHANT_CATEGORIES: "crypto",
  HOST: "127.0.0.1",
  LOG_LEVEL: "info",
  SHUTDOWN_DELAY_MS: "1000", // fenêtre où /ready doit déjà renvoyer 503
};

const findAvailablePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });

  const address = probe.address();
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  if (address === null || typeof address === "string") {
    throw new Error("port local temporaire introuvable");
  }
  return address.port;
};

const waitForServerAddress = (child: ChildProcess, readStderr: () => string): Promise<string> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`le serveur enfant n'est pas prêt après 10 s\n${readStderr()}`));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "event" in message &&
        message.event === "server_listening" &&
        "address" in message &&
        typeof message.address === "string"
      ) {
        cleanup();
        resolve(message.address);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `le serveur enfant s'est arrêté avant readiness (code=${code}, signal=${signal})\n${readStderr()}`,
        ),
      );
    };

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });

test(
  "SIGTERM: /ready passe à 503 pendant le drain, puis le serveur sort en 0",
  { skip },
  async (context) => {
    const port = await findAvailablePort();
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      env: { ...childEnv, PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    context.after(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    });

    const address = await waitForServerAddress(child, () => stderr);
    assert.equal(
      Number(new URL(address).port),
      port,
      `adresse inattendue du serveur enfant : ${address}`,
    );

    const before = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(before.status, 200);

    const exitPromise = once(child, "exit");
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const during = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(during.status, 503);

    const [code] = await exitPromise;
    assert.equal(code, 0);
  },
);
