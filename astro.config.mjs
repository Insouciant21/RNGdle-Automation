import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

const wranglerConfig = process.env.CLOUDFLARE_WRANGLER_CONFIG;

export default defineConfig({
  output: "server",
  ...(process.env.ASTRO_SITE ? { site: process.env.ASTRO_SITE } : {}),
  session: false,
  adapter: cloudflare({
    imageService: "passthrough",
    ...(wranglerConfig ? { configPath: wranglerConfig } : {}),
  }),
});
