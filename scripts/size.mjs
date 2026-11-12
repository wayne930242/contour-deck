// Measures the minified, gzipped core against the budgets in docs/DESIGN.md.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const budgets = [
  { name: "core JS", entry: "src/core/index.ts", limit: 12 * 1024, options: { format: "esm", target: "es2022" } },
  { name: "CSS", entry: "styles/index.css", limit: 6 * 1024, options: {} },
];

let failed = false;
for (const { name, entry, limit, options } of budgets) {
  const result = await build({ entryPoints: [entry], bundle: true, minify: true, write: false, logLevel: "warning", ...options });
  const raw = result.outputFiles[0].contents;
  const gzip = gzipSync(raw, { level: 9 }).length;
  const over = gzip > limit;
  failed ||= over;
  console.log(`${name}: ${raw.length} B minified, ${gzip} B gzip (${(gzip / 1024).toFixed(2)} KB) / budget ${limit} B ${over ? "OVER" : "ok"}`);
}
process.exit(failed ? 1 : 0);
