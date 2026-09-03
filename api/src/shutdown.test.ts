import { test } from "node:test";
import assert from "node:assert/strict";
import { shutdownGracefully } from "./shutdown.js";

const silentLog = { info() {}, error() {} };

function fakeApp(close: () => Promise<void>) {
  return { close, log: silentLog } as unknown as Parameters<typeof shutdownGracefully>[0];
}

test("resolves once app.close() completes", async () => {
  let closed = false;
  await shutdownGracefully(
    fakeApp(async () => {
      await new Promise((r) => setTimeout(r, 5));
      closed = true;
    }),
    1000,
  );
  assert.equal(closed, true);
});

test("rejects when draining exceeds the timeout", async () => {
  let release!: () => void;
  const slowClose = new Promise<void>((resolve) => {
    release = resolve;
  });

  await assert.rejects(
    shutdownGracefully(
      fakeApp(() => slowClose),
      20,
    ),
    /drainage non terminé en 20 ms/,
  );

  release(); // libère la promesse pour ne pas la laisser pendante
  await slowClose;
});

test("propagates an error from app.close()", async () => {
  await assert.rejects(
    shutdownGracefully(
      fakeApp(() => Promise.reject(new Error("close a échoué"))),
      1000,
    ),
    /close a échoué/,
  );
});
