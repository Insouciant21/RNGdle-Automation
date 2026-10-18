import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixtureConfig } from "../test/helpers/cloud-fixture.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-workers-test-"));
const config = JSON.parse(await fs.readFile("dist/server/wrangler.json", "utf8"));
config.main = path.resolve("dist/server", config.main);
config.assets.directory = path.resolve("dist/server", config.assets.directory);
config.name = "rngdle-runtime-test";
config.vars = { ...config.vars, CONFIG_JSON: JSON.stringify(fixtureConfig), MIGRATION_TOKEN: "e2e-migration-token", CONTROL_PUBLIC_URL: "http://localhost:4322" };
delete config.configPath;
delete config.userConfigPath;
await fs.writeFile(path.join(directory, "wrangler.json"), JSON.stringify(config));
const child = spawn("pnpm", ["exec", "wrangler", "dev", "--config", path.join(directory, "wrangler.json"), "--port", "4322", "--persist-to", path.join(directory, "state")], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", async (code) => { await fs.rm(directory, { recursive: true, force: true }); process.exit(code ?? 0); });
