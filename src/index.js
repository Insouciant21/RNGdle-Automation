#!/usr/bin/env node
import fs from "node:fs/promises";
import { loadConfig } from "./config.js";
import { createControlServer } from "./control.js";
import { errorSummary, log } from "./logger.js";
import { waitForInteractiveAuthentication } from "./rngdle.js";
import { isWorkflowDue, localParts } from "./schedule.js";
import { loadRuntimeSettings } from "./settings.js";
import { readState } from "./state.js";
import { runDailyWorkflow } from "./workflow.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runOnce(config, control) {
  const now = new Date();
  const { date } = localParts(now, config.timezone);
  await runDailyWorkflow(config, date, now, control);
}

async function runScheduler(config, control) {
  let stopping = false;
  const stop = (signal) => {
    log("info", "Stopping scheduler", { signal });
    stopping = true;
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  log("info", "Scheduler started", {
    timezone: config.timezone,
    time: config.schedule.time,
    retryMinutes: config.schedule.retryMinutes,
  });

  while (!stopping) {
    const now = new Date();
    const { date } = localParts(now, config.timezone);
    try {
      const state = await readState(config.storage.statePath);
      if (
        isWorkflowDue({
          now,
          timezone: config.timezone,
          scheduleTime: config.schedule.time,
          dayState: state.days[date],
        })
      ) {
        await runDailyWorkflow(config, date, now, control);
      }
    } catch (error) {
      log("error", "Scheduler tick failed", { error: errorSummary(error) });
    }
    if (!stopping) await sleep(config.schedule.pollSeconds * 1_000);
  }
}

async function main() {
  const command = process.argv[2] ?? "scheduler";
  const config = await loadConfig();
  await fs.mkdir(config.storage.directory, { recursive: true });
  if (await loadRuntimeSettings(config)) {
    log("info", "Runtime settings loaded", { path: config.storage.settingsPath });
  }
  const control = await createControlServer(config);
  try {
    if (command === "auth") {
      await waitForInteractiveAuthentication(config, control);
    } else if (command === "once") {
      await runOnce(config, control);
    } else if (command === "scheduler") {
      await runScheduler(config, control);
    } else {
      throw new Error(`Unknown command: ${command}. Use auth, once, or scheduler.`);
    }
  } finally {
    await control.close();
  }
}

main().catch((error) => {
  log("error", "Fatal error", { error: errorSummary(error) });
  process.exitCode = 1;
});
