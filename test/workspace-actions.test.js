import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceActions } from "../workspace-actions.js";

test("autonomous handoff persists real local brief, task, mail, and calendar artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localroom-actions-"));
  const service = new WorkspaceActions(root);
  const artifacts = service.execute("DELL-DEMO", {
    id: "brief-1",
    at: "2026-07-26T21:00:00.000Z",
    title: "Project Iliad brief",
    createdBy: "Kevin Tang",
    summary: "Advance the two-step cancellation flow.",
    decisions: ["Use a two-step guided flow"],
    commitments: [{
      id: "task-1", task: "Send the prototype to Legal", owner: "Maya", due: "Friday",
      status: "monitoring",
    }],
  });
  assert.deepEqual(artifacts.map((item) => item.service), ["Vault", "Tasks", "Mailroom", "Calendar"]);
  for (const artifact of artifacts) assert.ok(fs.statSync(artifact.localPath).size > 20);
  assert.match(fs.readFileSync(artifacts[0].localPath, "utf8"), /No cloud inference/);
  assert.match(fs.readFileSync(artifacts[2].localPath, "utf8"), /DRAFT-REQUIRES-APPROVAL/);
  assert.match(fs.readFileSync(artifacts[3].localPath, "utf8"), /BEGIN:VCALENDAR/);
  assert.deepEqual(service.monitor().commitments, 1);
});
