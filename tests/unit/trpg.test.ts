import { describe, expect, it } from "vitest";
import { counts, fixture, outline, sourceSlides, toHast, toHtml } from "./helpers.js";

const source = fixture("you-dont-have-to-lead-climb-alone.md");

/** No #### kicker anywhere: each part opens with a section divider, an h1 on a page of its own. */
describe("你不必獨自領攀 deck", () => {
  const view = outline(toHast(source, { title: "你不必獨自領攀" }));
  const slides = view.blocks.flatMap(block => block.slides);

  it("has the opening block and one block per h1 divider", () => {
    expect(view.blocks.map(block => block.title)).toEqual([
      "你不必獨自領攀",
      "拆解",
      "後勤的去中心化",
      "敘事權的重定位",
      "經營遊戲場域",
      "校準工具",
    ]);
    expect(view.blocks.map(block => [block.short, block.kind])).toEqual(Array(6).fill([undefined, undefined]));
    expect(view.blocks.map(block => block.slides.length)).toEqual([4, 8, 4, 4, 5, 7]);
  });

  it("counts 32 slides and 61 pages, as a reading of the source lines does", () => {
    expect(counts(view)).toEqual({ blocks: 6, slides: 32, pages: 61 });
    expect(slides.map(slide => [slide.legacy, slide.legacyV, slide.pages.length])).toEqual(
      sourceSlides(source).map(slide => [slide.h, slide.v, slide.pages])
    );
  });

  it("makes 玩家職位系統 one slide whose h3 children are its pages", () => {
    const roles = view.blocks[2].slides.find(slide => slide.title === "玩家職位系統");
    expect(roles).toBeDefined();
    expect(roles!.pages).toHaveLength(5);
    expect(roles!.pages.map(page => page.content[0])).toEqual(["h2", "h3", "h3", "h3", "h3"]);
    expect([roles!.legacy, roles!.legacyV]).toEqual([4, 5]);
  });

  it("splits 拆解 into one slide per ##, with the divider as its own slide", () => {
    expect(view.blocks[1].slides.map(slide => [slide.title, slide.pages.length])).toEqual([
      ["拆解", 1],
      ["領攀的譬喻", 3],
      ["面向一：GM 功能的擴充", 1],
      ["面向二：服務心態的互相承認", 4],
      ["遊戲時的認知負荷", 1],
      ["認知負荷與過度準備的惡性循環", 1],
      ["共享時刻的割裂", 2],
      ["冒險小隊", 1],
    ]);
  });

  it("keeps the slides of the h1 title slide in the opening block", () => {
    expect(view.blocks[0].slides.map(slide => slide.title)).toEqual([
      "你不必獨自領攀",
      "嗨，我是洪偉",
      "為什麼我們會感到疲憊？",
      expect.stringContaining("拆解"),
    ]);
  });

  it("writes data-legacy and data-legacy-v", () => {
    const html = toHtml(source, { title: "你不必獨自領攀" });
    expect(html).toContain('id="s-3-4" data-title="玩家職位系統" data-legacy="4" data-legacy-v="5"');
  });
});
