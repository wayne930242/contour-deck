/** DESIGN.md 原型驗證: the page stops of 三.4 and the wheel gesture, at 1440×810. */
import { expect, test } from "./fixtures.js";
import { expectAt, idle, openFromOutline, slideBox, wheelGesture } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await openFromOutline(page, "三、翻頁怎麼運作，第 4 張", "stage 4.4.1 +0");
});

test("opening 三.4 from the outline lands on its first page", async ({ page }) => {
  await expect(page).toHaveURL(/[?&]view=deck&at=4\.4\.1$/);
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-mode", "stage");
});

test("the slide has three stops: page 1, page 2, and the end of the tall page 2", async ({ page }) => {
  const box = await slideBox(page);
  expect(box.viewport).toBe(760);
  expect(box.pages).toHaveLength(2);
  expect(box.pages[1].top).toBe(760);
  // Page 2 is taller than the viewport, by less than one 85% step: one extra stop, flush with its bottom.
  expect(box.pages[1].height).toBeGreaterThan(760 + 8);
  expect(box.pages[1].height).toBeLessThan(760 * 1.65);
  const end = box.height - box.viewport;
  expect(end).toBe(box.pages[1].height);

  const visited = [box.top];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowDown");
    await idle(page);
    visited.push((await slideBox(page)).top);
  }
  expect(visited).toEqual([0, 760, end, end, end]);
  await expectAt(page, "stage 4.4.2 +0");

  await page.keyboard.press("ArrowUp");
  await idle(page);
  expect((await slideBox(page)).top).toBe(760);
});

test("one wheel gesture with its inertia tail moves one stop; the next ends the page; a third does nothing", async ({ page }) => {
  const end = await slideBox(page).then(box => box.height - box.viewport);

  await wheelGesture(page, 120);
  await idle(page);
  expect((await slideBox(page)).top).toBe(760);
  await expectAt(page, "stage 4.4.2 +0");

  await page.waitForTimeout(450);
  await wheelGesture(page, 120);
  await idle(page);
  expect((await slideBox(page)).top).toBe(end);
  await expectAt(page, "stage 4.4.2 +0");

  await page.waitForTimeout(450);
  await wheelGesture(page, 120);
  await idle(page);
  expect((await slideBox(page)).top).toBe(end);
  await expectAt(page, "stage 4.4.2 +0");
});

test("a long unbroken tail never moves a second stop", async ({ page }) => {
  const tail: number[] = [];
  for (let size = 100; size > 3; size *= 0.9) tail.push(size);
  await wheelGesture(page, 120, tail);
  await idle(page);
  expect((await slideBox(page)).top).toBe(760);
});

test("the page marks show two pages and fill as the tall page is read", async ({ page }) => {
  const marks = page.locator(".ct-pager i");
  await expect(marks).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await idle(page);
  await expect(marks.nth(1)).toHaveAttribute("data-on", "");
  const partial = Number(await marks.nth(1).evaluate(el => (el as HTMLElement).style.getPropertyValue("--f")));
  expect(partial).toBeGreaterThan(0.5);
  expect(partial).toBeLessThan(1);
  await page.keyboard.press("ArrowDown");
  await idle(page);
  // Firefox reports fractional scroll offsets, so "all read" is 1 to within a hair.
  expect(Number(await marks.nth(1).evaluate(el => (el as HTMLElement).style.getPropertyValue("--f")))).toBeCloseTo(1, 3);
});
