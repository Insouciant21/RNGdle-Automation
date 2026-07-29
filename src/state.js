import fs from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = { version: 1, days: {} };

export async function readState(statePath) {
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (state.version !== 1 || !state.days || typeof state.days !== "object") {
      throw new Error("unsupported state format");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(EMPTY_STATE);
    }
    throw new Error(`Unable to read ${statePath}: ${error.message}`);
  }
}

export async function writeState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, statePath);
}

export function pruneState(state, keep = 45) {
  const dates = Object.keys(state.days).sort().reverse();
  for (const date of dates.slice(keep)) {
    delete state.days[date];
  }
}

export async function acquireLock(lockPath, staleMilliseconds = 20 * 60_000) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await handle.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= staleMilliseconds) {
      return null;
    }
    await fs.unlink(lockPath);
    return acquireLock(lockPath, staleMilliseconds);
  }

  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(lockPath, now, now).catch(() => {});
  }, Math.min(60_000, Math.floor(staleMilliseconds / 3)));
  heartbeat.unref();

  return async () => {
    clearInterval(heartbeat);
    await fs.unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
}
