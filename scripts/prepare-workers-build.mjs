#!/usr/bin/env node
import fs from "node:fs/promises";
import { workerBuildConfig } from "./worker-config.mjs";

const sourcePath = "wrangler.jsonc";
const outputPath = "wrangler.workers-build.jsonc";
const config = workerBuildConfig(JSON.parse(await fs.readFile(sourcePath, "utf8")), process.env);
await fs.writeFile(outputPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
await fs.chmod(outputPath, 0o600);
console.log(`Prepared Wrangler config: ${outputPath}`);
