// Regenerates tests/fixtures/trpg.html and kicker.html: the plugin output for the 你不必獨自領攀 deck
// and the self-written kicker deck.
// Runs the built plugins (dist/), so `pnpm fixtures` builds first.
// The pipeline mirrors tests/unit/helpers.ts; tests/unit/fixtures.test.ts fails when they drift apart.
import { readFileSync, writeFileSync } from "node:fs";
import rehypeStringify from "rehype-stringify";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { rehypeDeck } from "../dist/rehype/index.js";
import { remarkDeck } from "../dist/remark/index.js";

/** Stand-in for the blog's other directives: `:icon` is an inline span, unknown containers a div. */
function remarkHostDirectives() {
  return tree => {
    const visit = node => {
      if (node.type === "textDirective" && node.name === "icon") node.data = { hName: "span" };
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

async function render(file, title) {
  const source = readFileSync(`tests/fixtures/${file}`, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  return String(
    await unified()
      .use(remarkParse)
      .use(remarkCjkFriendly)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkHostDirectives)
      .use(remarkDeck)
      .use(remarkRehype)
      .use(rehypeDeck, { title })
      .use(rehypeStringify)
      .process(source)
  );
}

for (const [source, target, title] of [
  ["you-dont-have-to-lead-climb-alone.md", "trpg.html", "你不必獨自領攀"],
  ["kicker-deck.md", "kicker.html", "輪廓優先的簡報"],
]) {
  const html = await render(source, title);
  writeFileSync(`tests/fixtures/${target}`, `${html}\n`);
  console.log(`tests/fixtures/${target}: ${html.length} characters`);
}
