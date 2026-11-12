import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture, toHtml } from "./helpers.js";

const stored = (name: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");

describe("tests/fixtures", () => {
  it.each([
    ["trpg.html", "you-dont-have-to-lead-climb-alone.md", "你不必獨自領攀"],
    ["kicker.html", "kicker-deck.md", "輪廓優先的簡報"],
  ])("%s is what the plugins write today (run `pnpm fixtures` after changing them)", (html, markdown, title) => {
    expect(stored(html)).toBe(`${toHtml(fixture(markdown), { title })}\n`);
  });

  it("holds no restricted post", () => {
    for (const name of ["kicker-deck.md", "you-dont-have-to-lead-climb-alone.md", "slide-templates-demo.md"]) {
      expect(fixture(name)).not.toMatch(/^(status: restricted|pass\w*:)/m);
    }
  });
});
