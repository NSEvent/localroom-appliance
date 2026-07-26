import assert from "node:assert/strict";
import test from "node:test";
import { createHealthSnapshot } from "../appliance-health.js";

test("health reports an idle appliance without creating a phantom room", async () => {
  const rooms = new Map();
  const snapshot = createHealthSnapshot({
    asrURL: "http://127.0.0.1:9",
    models: { models: async () => [] },
    intelligence: {
      rooms,
      room: () => { throw new Error("health must not create a room"); },
    },
    voiceCatalog: [],
    audit: { read: () => [] },
    demoMemory: [],
    corpusStats: () => ({ records: 0 }),
    dataDir: "/tmp/localroom-health-test",
    workspace: { monitor: () => ({ commitments: 0 }) },
    glossary: { stats: () => ({ terms: 0 }) },
    recognitions: { read: () => [] },
    onModels: () => {},
  });

  const result = await snapshot({ socket: { remoteAddress: "127.0.0.1" } });

  assert.equal(result.status, "ok");
  assert.equal(result.mode, "demo-safe");
  assert.equal(result.capture.client_is_appliance, true);
  assert.equal(rooms.size, 0);
});
