import { defineWranglerConfig } from "wrangler/experimental-config";

// Build settings only. cloudflare.config.ts remains the Worker/resource source of truth.
export default defineWranglerConfig({
  assetsDirectory: "./public",
  minify: true,
  uploadSourceMaps: true,
  types: { generate: true, includeRuntime: false },
});

