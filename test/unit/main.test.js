import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { installSignalHandlers } from "../../src/main.js";

test("SIGTERM and SIGINT share one idempotent graceful-shutdown path", async () => {
  const runtime = new EventEmitter(); runtime.stderr = { write() {} }; runtime.exitCode = 0;
  let shutdownCalls = 0;
  let release;
  const shutdown = new Promise((resolve) => { release = resolve; });
  const application = { async shutdown() { shutdownCalls += 1; await shutdown; } };
  installSignalHandlers(application, runtime);
  runtime.emit("SIGTERM"); runtime.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownCalls, 1);
  release(); await shutdown;
  assert.equal(runtime.exitCode, 0);
});
