// Measures the minified, gzipped bundles: the core and the CSS against the budgets in docs/DESIGN.md,
// and the parts of contour-deck/remote, which load on demand and are reported for the record.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const esm = { format: "esm", target: "es2022" };
const client = ["protocol", "transport", "pairing", "guest", "clock", "store"];
const bundles = [
  { name: "core JS", entry: "src/core/index.ts", limit: 12 * 1024, options: esm },
  { name: "CSS", entry: "styles/index.css", limit: 6 * 1024, options: {} },
  // No budget of their own: each is one lazy chunk, and shares the modules listed under "remote client".
  { name: "remote, everything (the demo's second script)", entry: "src/remote/index.ts", options: esm },
  {
    name: "remote client (protocol, transports, pairing, guest, clock; no UI)",
    stdin: { contents: client.map(name => `export * from "./src/remote/${name}.ts";`).join("\n"), resolveDir: ".", loader: "ts" },
    options: esm,
  },
  { name: "remote UI on the deck (panel, laser, ink) with the client", entry: "src/remote/session.ts", options: esm },
  { name: "remote UI on the phone (with tilt) with the client", entry: "src/remote/phone.ts", options: esm },
  { name: "remote UI of the presenter window with the client", entry: "src/remote/presenter.ts", options: esm },
  { name: "built-in QR encoder (loaded when no qr option is given)", entry: "src/remote/qr.ts", options: esm },
];

let failed = false;
for (const { name, entry, stdin, limit, options } of bundles) {
  const source = stdin ? { stdin } : { entryPoints: [entry] };
  const result = await build({ ...source, bundle: true, minify: true, write: false, logLevel: "warning", ...options });
  const raw = result.outputFiles[0].contents;
  const gzip = gzipSync(raw, { level: 9 }).length;
  const over = limit !== undefined && gzip > limit;
  failed ||= over;
  const verdict = limit === undefined ? "" : ` / budget ${limit} B ${over ? "OVER" : "ok"}`;
  console.log(`${name}: ${raw.length} B minified, ${gzip} B gzip (${(gzip / 1024).toFixed(2)} KB)${verdict}`);
}
process.exit(failed ? 1 : 0);
