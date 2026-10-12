import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const entry = join(root, "..", "src", "index.ts");
const outfile = join(root, "..", "..", "claude", "server", "index.js");

mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
});
