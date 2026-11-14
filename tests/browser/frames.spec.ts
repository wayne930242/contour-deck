/** Opening and closing blocks: the deck opens on the title pages, the thank-you follows the talk, and neither is on the map. */
import { expect, test } from "./fixtures.js";
import { expectAt, idle } from "./helpers.js";

const DEMO = "/demo/frames.html";

const visibleTiles = (page: import("@playwright/test").Page) =>
  page.locator(".ct-tile").evaluateAll(tiles => tiles.filter(tile => (tile as HTMLElement).offsetParent).map(tile => tile.querySelector(".ct-tt")?.textContent));
const visibleRail = (page: import("@playwright/test").Page) =>
  page.locator(".ct-rg").evaluateAll(groups => groups.filter(group => (group as HTMLElement).offsetParent).map(group => group.querySelector(".ct-rl")?.textContent));

test("without at it opens on the opening; past its last slide comes the outline of the talk", async ({ page }) => {
  await page.goto(DEMO);
  await page.locator("#start").click();
  await expectAt(page, "stage 1.1.1 +0");
  await expect(page.locator("#cover h1")).toBeInViewport();
  await expect(page.locator(".ct-rm")).toHaveCSS("visibility", "hidden");

  // ← on its first slide does nothing.
  await page.keyboard.press("ArrowLeft");
  await idle(page);
  await expectAt(page, "stage 1.1.1 +0");

  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 1.2.1 +0");
  await idle(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "overview 2.1.1 +0");
  await expect(page.locator(".ct-thumb[data-ct-go='1,0,0']")).toBeFocused();
  expect(await visibleTiles(page)).toEqual(["引言", "一、正文", "附錄"]);
  // A block without a label is numbered as the talk counts: the opening is not block 1.
  expect(await visibleRail(page)).toEqual(["引", "2", "附"]);

  await page.keyboard.press("Enter");
  await expectAt(page, "stage 2.1.1 +0");
  await expect(page.locator(".ct-rm")).toHaveCSS("visibility", "visible");
  await idle(page);
  // ← from the talk's first slide goes back into the opening, to its last slide.
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 1.2.1 +0");
});

test("Esc and O from the opening go to the outline at the talk's first slide", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "stage 1.1.1 +0");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.1.1 +0");
  await page.goto(`${DEMO}?view=deck&at=1.2`);
  await expectAt(page, "stage 1.2.1 +0");
  await page.keyboard.press("o");
  await expectAt(page, "overview 2.1.1 +0");
});

test("past the talk's last slide comes the closing, past the appendix; ← goes back, Esc goes to the outline", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=3.1`);
  await expectAt(page, "stage 3.1.1 +0");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 5.1.1 +0");
  await expect(page.locator("#thanks h2")).toBeInViewport();
  await expect(page.locator(".ct-rm")).toHaveCSS("visibility", "hidden");
  await idle(page);
  await page.keyboard.press("ArrowRight");
  await idle(page);
  await expectAt(page, "stage 5.1.1 +0");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 3.1.1 +0");
  await idle(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 5.1.1 +0");
  await idle(page);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 3.1.1 +0");
  await expect(page.locator(".ct-thumb[data-ct-go='2,0,0']")).toBeFocused();
});

test("deep links reach both, and the API can go to them from the outline", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=5.1`);
  await expectAt(page, "stage 5.1.1 +0");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 3.1.1 +0");
  await page.evaluate(() => window.contourDemo.deck!.go("1.1"));
  await expectAt(page, "stage 1.1.1 +0");
});

test("on the depth desk the talk's first block is the first row", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.1.1 +0");
  await page.keyboard.press("3");
  await expect(page.locator(".ct-tile[data-ct-front] .ct-tt")).toHaveText("引言");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".ct-tile[data-ct-front] .ct-tt")).toHaveText("一、正文");
  await page.keyboard.press("End");
  await expect(page.locator(".ct-tile[data-ct-front] .ct-tt")).toHaveText("附錄");
  await page.keyboard.press("Home");
  await expect(page.locator(".ct-tile[data-ct-front] .ct-tt")).toHaveText("引言");
  await expect(page.locator(".ct-tile[data-ct-past]")).toHaveCount(0);
});

/** The transforms of the animations running on the stage and the outline right now. */
const motion = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const of = (selector: string) =>
      document
        .querySelector(selector)!
        .getAnimations()
        .flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => String(frame.transform ?? "")));
    return { stage: of(".ct-stage"), outline: of(".ct-ov"), outlineShown: getComputedStyle(document.querySelector(".ct-ov")!).visibility };
  });

test("no thumbnail to zoom from: the stage lifts in and sinks away, the outline rises behind it", async ({ page }) => {
  await page.goto(DEMO);
  await page.locator("#start").click();
  // Opening the deck: the stage lifts in, and the outline never shows.
  const start = await motion(page);
  expect(start.stage.join()).toContain("scale(0.94)");
  expect(start.outlineShown).toBe("hidden");
  await idle(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 1.2.1 +0");
  await idle(page);
  // Past the opening: the stage sinks, the outline rises, and nothing zooms (no translate).
  await page.keyboard.press("ArrowRight");
  const out = await motion(page);
  expect(out.stage.join()).toContain("scale(0.94)");
  expect(out.stage.join()).not.toContain("translate");
  expect(out.outline.join()).toContain("translateY");
  await expectAt(page, "overview 2.1.1 +0");
  await page.evaluate(() => window.contourDemo.deck!.go("3.1"));
  await expectAt(page, "stage 3.1.1 +0");
  await idle(page);
  // Into the closing: a cut, with the outline kept hidden.
  await page.keyboard.press("ArrowRight");
  const cut = await motion(page);
  expect(cut.stage.join()).toContain("scale(0.94)");
  expect(cut.outlineShown).toBe("hidden");
  await expectAt(page, "stage 5.1.1 +0");
});

test("with reduced motion the opening and the closing only fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${DEMO}?view=deck&at=1.2`);
  await expectAt(page, "stage 1.2.1 +0");
  await idle(page);
  await page.keyboard.press("ArrowRight");
  const out = await motion(page);
  expect([...out.stage, ...out.outline].join("")).toBe("");
  await expectAt(page, "overview 2.1.1 +0");
});

test("closed, the document shows the opening and the closing in place", async ({ page }) => {
  await page.goto(DEMO);
  await expect(page.locator("#cover h1")).toBeVisible();
  await expect(page.locator("#thanks h2")).toBeVisible();
});
