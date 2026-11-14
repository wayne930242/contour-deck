/** The flat outline grows with the stage while every block still fits, and keeps its sizes when they do not. */
import { expect, test } from "./fixtures.js";
import { expectAt } from "./helpers.js";

const sizes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const px = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
    const ov = document.querySelector<HTMLElement>(".ct-ov")!;
    return {
      fit: parseFloat(ov.style.getPropertyValue("--ct-ov-fit")),
      tile: px(".ct-tile:not([hidden]) .ct-tt"),
      thumb: px(".ct-tile:not([hidden]) .ct-t"),
      thumbWidth: document.querySelector<HTMLElement>(".ct-tile:not([hidden]) .ct-thumb")!.offsetWidth,
      scrolls: ov.scrollHeight > ov.clientHeight + 1,
      room: ov.clientHeight - ov.scrollHeight,
    };
  });

test("on a large stage with few blocks the outline grows: block titles about twice, thumbnails half again, all in view", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/demo/frames.html?view=deck");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.1.1 +0");
  const big = await sizes(page);
  expect(big.fit).toBeGreaterThan(1.4);
  expect(big.tile / 15.2).toBeGreaterThan(1.8);
  expect(big.thumb / 10.24).toBeGreaterThan(1.4);
  expect(big.thumbWidth).toBeGreaterThan(7.6 * 16 * 1.4);
  expect(big.scrolls).toBe(false);
  // The ring follows the bigger thumbnail.
  const [ring, face] = await Promise.all([page.locator(".ct-ring").boundingBox(), page.locator(".ct-thumb[data-ct-go='1,0,0'] .ct-face").boundingBox()]);
  expect(Math.abs(ring!.width - face!.width)).toBeLessThan(2);
  expect(Math.abs(ring!.x - face!.x)).toBeLessThan(2);

  // A smaller window shrinks it again.
  await page.setViewportSize({ width: 1000, height: 560 });
  await expect.poll(async () => (await sizes(page)).fit).toBeLessThan(big.fit);
  expect((await sizes(page)).scrolls).toBe(false);
});

test("when the blocks do not fit even at the old sizes, the outline keeps them and scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto("/demo/index.html?view=deck&at=1.1");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 1.1.1 +0");
  const small = await sizes(page);
  expect(small.fit).toBe(1);
  expect(small.tile).toBeCloseTo(15.2, 1);
  expect(small.thumb).toBeCloseTo(10.24, 1);
  expect(small.scrolls).toBe(true);
});

test("a host fixes the scale and the title sizes with CSS variables", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/demo/frames.html?view=deck");
  await page.addStyleTag({ content: ".ct-app { --ct-outline-scale: 1.25; --ct-tile-title-size: 2em; --ct-thumb-title-size: 1em; }" });
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.1.1 +0");
  const fixed = await sizes(page);
  expect(fixed.tile).toBeCloseTo(40, 0);
  expect(fixed.thumb).toBeCloseTo(20, 0);
});

test("the depth desk keeps its own sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/demo/frames.html?view=deck");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.1.1 +0");
  await page.keyboard.press("3");
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
  await expect.poll(async () => (await sizes(page)).tile).toBeCloseTo(15.2, 1);
});
