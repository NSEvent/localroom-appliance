import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const port = 4317;
const baseURL = `http://127.0.0.1:${port}`;
const dataDir = path.join(os.tmpdir(), `localroom-e2e-${process.pid}`);

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    headless: true,
    channel: process.env.CI ? undefined : "chrome",
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  webServer: {
    command: "node server.js",
    url: `${baseURL}/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      LOCALROOM_DATA_DIR: dataDir,
      ASR_URL: "http://127.0.0.1:9",
      QWEN_URL: "http://127.0.0.1:9/v1",
      NEMOTRON_URL: "http://127.0.0.1:9/v1",
      FAST_MODEL_URL: "http://127.0.0.1:9/v1",
    },
  },
});
