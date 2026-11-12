// Builds the package (dist/) and the demo assets (demo/assets/).
import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

const core = "src/core/index.ts";
const css = "styles/index.css";

rmSync("dist", { recursive: true, force: true });
rmSync("demo/assets", { recursive: true, force: true });

// Every module under src/ becomes dist/<same path>.js with its .d.ts.
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });

await build({ entryPoints: [css], bundle: true, outfile: "dist/style.css", logLevel: "warning" });

// Astro components ship as source, next to the modules they import.
for (const file of readdirSync("src/astro")) {
  if (file.endsWith(".astro")) cpSync(`src/astro/${file}`, `dist/astro/${file}`);
}

// The demo runs from file:// too, so it loads a classic script, not a module.
await build({
  entryPoints: [core],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "ContourDeck",
  target: "es2022",
  outfile: "demo/assets/contour-deck.js",
  logLevel: "warning",
});
await build({ entryPoints: [css], bundle: true, minify: true, outfile: "demo/assets/contour-deck.css", logLevel: "warning" });
