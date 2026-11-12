// Wraps the plugin fixtures (tests/fixtures/*.html) in the demo page so the
// core can run real plugin output: node scripts/demo-decks.mjs
// Writes demo/decks/<name>.html (ignored); open with `pnpm demo`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const shell = readFileSync("demo/index.html", "utf8");
const start = shell.indexOf("  <div data-ct-deck");
const end = shell.indexOf("</main>");
if (start < 0 || end < 0) {
  throw new Error("demo/index.html no longer has the deck between <div data-ct-deck> and </main>");
}

const decks = [
  ["trpg", "你不必獨自領攀"],
  ["kicker", "輪廓優先的簡報"],
];

mkdirSync("demo/decks", { recursive: true });
for (const [name, title] of decks) {
  const deck = readFileSync(`tests/fixtures/${name}.html`, "utf8");
  const page = (shell.slice(0, start) + deck + "\n" + shell.slice(end))
    .replace(/<title>[^<]*<\/title>/, `<title>contour-deck｜${title}</title>`)
    .replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`)
    .replaceAll('href="assets/', 'href="../assets/')
    .replaceAll('src="assets/', 'src="../assets/')
    .replace('href="demo.css"', 'href="../demo.css"')
    .replace('href="./"', 'href="../"')
    .replaceAll('href="decks/', 'href="');
  writeFileSync(`demo/decks/${name}.html`, page);
  console.log(`demo/decks/${name}.html`);
}
