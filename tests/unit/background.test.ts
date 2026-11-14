import { describe, expect, it } from "vitest";
import { youtubeUrl } from "../../src/core/background.js";
import { youtubeId } from "../../src/remark/index.js";
import { findAll, isEl, outline, toHast, toHtml, type Hast } from "./helpers.js";

const backgrounds = (markdown: string, structure?: "headings") =>
  findAll(toHast(markdown, structure ? { structure } : {}), "dataCtBackground");

const pagesOf = (root: Hast) => findAll(root, "dataCtPage");

describe("::background", () => {
  it("writes the image as the still of a data-ct-background element, first in its page", () => {
    const html = toHtml(`## 標題\n\n內文\n\n::background{image="/img/board.jpg" dim=0.6 position="50% 20%"}`);
    expect(html).toContain(
      '<section data-ct-page data-ms="3400"><div data-ct-background style="--ct-dim: 0.6; --ct-position: 50% 20%"><img src="/img/board.jpg" alt="" decoding="async"></div><h2 style="--i: 0">'
    );
    expect(html).not.toContain("data-ct-mark");
  });

  it("carries a video file with its loop and poster", () => {
    const [bg] = backgrounds(`::background{video="https://example.com/clip.mp4" start=12 end=40 poster="/img/clip.jpg" dim=0.5}\n\n內文`);
    expect(bg.properties).toMatchObject({ dataVideo: "https://example.com/clip.mp4", dataStart: "12", dataEnd: "40", style: "--ct-dim: 0.5" });
    expect(bg.children?.filter(isEl).map(img => img.properties.src)).toEqual(["/img/clip.jpg"]);
  });

  it("takes a YouTube id or URL and writes the id", () => {
    for (const source of ["dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) {
      const [bg] = backgrounds(`::background{youtube="${source}" start=30 end=55 poster="/f.jpg"}\n\n內文`);
      expect(bg.properties?.dataYoutube).toBe("dQw4w9WgXcQ");
    }
    expect(youtubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
  });

  it("writes a credit as plain text after the still, and takes dim up to 1", () => {
    const html = toHtml(`::background{image="/a.jpg" dim=0.9 credit="Photo: **A. B.**, CC BY-SA 4.0"}\n\n內文`);
    expect(html).toContain('<div data-ct-background style="--ct-dim: 0.9"><img src="/a.jpg" alt="" decoding="async"><small data-ct-credit>Photo: **A. B.**, CC BY-SA 4.0</small></div>');
    expect(() => toHast(`::background{image="/a.jpg" dim=1}`)).not.toThrow();
  });

  it("leaves a video without poster with no still", () => {
    const [bg] = backgrounds(`::background{youtube="dQw4w9WgXcQ"}\n\n內文`);
    expect(bg.children).toEqual([]);
  });

  it("moves to the page it is written on from inside other elements, out of steps and the reading time", () => {
    const root = toHast(`## 標題\n\n:::build\n- 一\n\n::background{image="/a.jpg"}\n\n- 二\n:::`);
    const [page] = pagesOf(root);
    const first = page.children?.find(isEl);
    expect(first?.properties && "dataCtBackground" in first.properties).toBe(true);
    for (const bg of findAll(root, "dataCtBackground")) expect(findAll(bg, "dataCtStep")).toEqual([]);
  });

  it("belongs to the page it is written on, in both structures", () => {
    const slides = outline(toHast(`## 一\n\n甲\n\n::vertical\n\n::background{image="/a.jpg"}\n\n乙`));
    expect(slides.blocks[0].slides[0].pages.map(page => page.content)).toEqual([["h2", "p"], ["div", "p"]]);

    const root = toHast(`::background{image="/a.jpg"}\n\n## 一\n\n甲\n\n### 頁二\n\n乙`, { structure: "headings" });
    const view = outline(root);
    // Like notes, a background before the first ## opens the first slide and does not make a slide of its own.
    expect(view.blocks[0].slides).toHaveLength(1);
    expect(view.blocks[0].slides[0].title).toBe("一");
    expect(view.blocks[0].slides[0].pages.map(page => page.content)).toEqual([["div", "h2", "p"], ["h3", "p"]]);
  });

  it("does not hide a kicker or a divider", () => {
    const view = outline(toHast(`::background{image="/a.jpg"}\n\n# 拆解\n\n---\n\n## 一\n\n甲`));
    expect(view.blocks[0].title).toBe("拆解");
  });

  it.each([
    ["no source", `::background{dim=0.5}`, "::background needs a source"],
    ["two sources", `::background{image="/a.jpg" youtube="dQw4w9WgXcQ"}`, "takes one source, got image and youtube"],
    ["an empty source", `::background{image=""}`, "image is empty"],
    ["a bad YouTube id", `::background{youtube="abc"}`, "youtube must be an 11-character video id"],
    ["a poster on an image", `::background{image="/a.jpg" poster="/b.jpg"}`, "poster is for video and youtube"],
    ["start on an image", `::background{image="/a.jpg" start=3}`, "start is for video and youtube"],
    ["a negative start", `::background{video="/a.mp4" start=-1}`, "start must be seconds"],
    ["end before start", `::background{video="/a.mp4" start=10 end=5}`, "end (5) must be after start (10)"],
    ["dim above 1", `::background{image="/a.jpg" dim=1.5}`, "dim must be a number from 0 to 1"],
    ["dim as text", `::background{image="/a.jpg" dim=dark}`, "dim must be a number from 0 to 1"],
    ["a CSS injection in position", `::background{image="/a.jpg" position="center; color: red"}`, "position must be an object-position"],
    ["an empty credit", `::background{image="/a.jpg" credit=" "}`, "credit is empty"],
    ["an unknown attribute", `::background{image="/a.jpg" muted}`, 'background has no attribute "muted"'],
    ["the container form", `:::background{image="/a.jpg"}\n:::`, "background is a leaf directive"],
    ["two on one page", `::background{image="/a.jpg"}\n\n::background{image="/b.jpg"}\n\n內文`, "a page holds two ::background directives"],
  ])("fails fast on %s", (_name, markdown, message) => {
    expect(() => toHast(markdown)).toThrow(message);
  });
});

describe("youtubeUrl", () => {
  it("embeds without cookies, muted, without controls, related videos, or keyboard", () => {
    const url = new URL(youtubeUrl("dQw4w9WgXcQ", 30.5, "https://wayneh.tw"));
    expect(url.origin + url.pathname).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      autoplay: "1",
      mute: "1",
      controls: "0",
      rel: "0",
      disablekb: "1",
      enablejsapi: "1",
      start: "30",
      origin: "https://wayneh.tw",
    });
    // The deck loops before the end itself, so the player never shows its ended bezel.
    expect(url.searchParams.has("end")).toBe(false);
    expect(new URL(youtubeUrl("dQw4w9WgXcQ", 0, "null")).searchParams.has("origin")).toBe(false);
  });
});
