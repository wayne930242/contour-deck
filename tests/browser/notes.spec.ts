/** Speaker notes: the panel beside the stage, and the notes view a phone opens on the same page. */
import { expect, test } from "./fixtures.js";
import { DEMO, expectAt, idle, slideBox } from "./helpers.js";

test("N opens the notes of the current page beside the stage and keeps the position", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4.2`);
  await expectAt(page, "stage 4.4.2 +0");
  const panel = page.locator(".ct-notes");
  await expect(panel).toBeHidden();
  // On the stage itself the notes stay hidden.
  await expect(page.locator(".ct-stage [data-ct-notes]").first()).toBeHidden();
  const wide = (await page.locator(".ct-stage").boundingBox())!.width;

  await page.keyboard.press("n");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "講稿" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator("h2")).toHaveText("三 · 4/6 · 頁 2/2");
  await expect(panel).toContainText("長頁多出來的部分會多一個停靠點");
  expect((await page.locator(".ct-stage").boundingBox())!.width).toBeLessThan(wide - 200);
  await expectAt(page, "stage 4.4.2 +0");
  const box = await slideBox(page);
  expect(box.top).toBe(box.pages[1].top);

  await page.keyboard.press("ArrowUp");
  await expectAt(page, "stage 4.4.1 +0");
  await expect(panel.locator("h2")).toHaveText("三 · 4/6 · 頁 1/2");
  await expect(panel).toContainText("但是一頁的內容可能比螢幕高");

  await page.getByRole("button", { name: "講稿" }).click();
  await expect(panel).toBeHidden();
  await expectAt(page, "stage 4.4.1 +0");
});

test("a page without notes says so", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=7.1`);
  await page.keyboard.press("n");
  await expect(page.locator(".ct-nb")).toHaveText("（這一頁沒有講稿）");
});

test("the notes view is the whole script on one scrolling page", async ({ page }) => {
  await page.goto(`${DEMO}?view=notes`);
  await expectAt(page, "notes 1.1.1 +0");
  const script = page.locator(".ct-script");
  await expect(script).toBeVisible();
  await expect(page.locator(".ct-stage")).toBeHidden();
  await expect(page.locator(".ct-ov")).toBeHidden();
  await expect(script.locator(".ct-se")).toHaveCount(34);
  await expect(script.locator(".ct-sbh")).toHaveCount(7);
  await expect(script.locator(".ct-sbh").nth(3)).toHaveText("三、翻頁怎麼運作約 5 分");
  const entry = script.locator(".ct-se", { hasText: "長頁怎麼停靠？兩個例子" });
  await expect(entry.locator(".ct-sh .ct-meta")).toHaveText("三.4 · 頁 2/2");
  await expect(entry.locator(".ct-sn")).toContainText("長頁多出來的部分會多一個停靠點");
  await expect(page).toHaveURL(/[?&]view=notes$/);

  // It scrolls on its own: the deck does not move.
  await script.evaluate(el => el.scrollTo(0, 3000));
  await expect.poll(() => script.evaluate(el => el.scrollTop)).toBe(3000);
  await expectAt(page, "notes 1.1.1 +0");
  for (const key of ["Space", "ArrowRight", "PageDown"]) await page.keyboard.press(key);
  await expectAt(page, "notes 1.1.1 +0");
});

test("the notes view opens at the position in the URL", async ({ page }) => {
  await page.goto(`${DEMO}?view=notes&at=4.4.2`);
  await expectAt(page, "notes 4.4.2 +0");
  const entry = page.locator(".ct-se", { hasText: "長頁怎麼停靠？兩個例子" });
  await expect(entry).toBeInViewport();
  const top = await entry.evaluate(el => el.getBoundingClientRect().top - el.closest(".ct-script")!.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(80);
});

test("an entry heading opens that page on the stage; the outline and the notes view lead to each other", async ({ page }) => {
  await page.goto(`${DEMO}?view=notes`);
  await page.locator(".ct-se", { hasText: "長頁怎麼停靠？兩個例子" }).locator(".ct-sh").click();
  await expectAt(page, "stage 4.4.2 +0");
  await expect(page.locator(".ct-script")).toBeHidden();
  expect((await slideBox(page)).top).toBe(760);
  await expect(page).toHaveURL(/view=deck&at=4\.4\.2$/);

  await page.keyboard.press("Escape");
  await expectAt(page, "overview 4.4.2 +0");
  await page.getByRole("button", { name: "提詞" }).click();
  await expectAt(page, "notes 4.4.2 +0");
  await expect(page.locator(".ct-se", { hasText: "長頁怎麼停靠？兩個例子" })).toBeInViewport();
  await page.getByRole("button", { name: "輪廓" }).click();
  await expectAt(page, "overview 4.4.2 +0");
  await expect(page.locator(".ct-ov")).toBeVisible();
});

test("the notes view keeps the screen awake, and lets go when it is left", async ({ page }) => {
  await page.addInitScript(() => {
    const calls = { requested: 0, released: 0 };
    Object.assign(window, { wakeCalls: calls });
    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: async () => {
          calls.requested++;
          return { release: async () => void calls.released++ };
        },
      },
    });
  });
  const calls = () => page.evaluate(() => (window as unknown as { wakeCalls: { requested: number; released: number } }).wakeCalls);
  await page.goto(`${DEMO}?view=notes`);
  await expectAt(page, "notes 1.1.1 +0");
  expect(await calls()).toEqual({ requested: 1, released: 0 });
  // Coming back to the page asks again: the browser dropped the lock while it was hidden.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await calls()).toEqual({ requested: 2, released: 0 });
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 1.1.1 +0");
  await expect.poll(calls).toEqual({ requested: 2, released: 1 });
  await page.keyboard.press("Enter");
  await expectAt(page, "stage 1.1.1 +0");
  expect((await calls()).requested).toBe(2);
});

test.describe("on a phone (390×760)", () => {
  test.use({ viewport: { width: 390, height: 760 } });

  test("the notes view reads at a comfortable size without sideways scrolling", async ({ page }) => {
    await page.goto(`${DEMO}?view=notes&at=4.4.2`);
    const script = page.locator(".ct-script");
    await expect(script).toBeVisible();
    expect(await script.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const size = await script.locator(".ct-sn p").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(17);
  });

  test("the deck reflows: one column of blocks, readable pages, notes under the stage", async ({ page }) => {
    await page.goto(`${DEMO}?view=deck`);
    const lefts = await page.locator(".ct-tile").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
    await page.locator('.ct-thumb[aria-label^="三、翻頁怎麼運作，第 3 張"]').click();
    await expectAt(page, "stage 4.3.1 +0");
    await idle(page);
    const current = page.locator("[data-ct-current]");
    expect(await current.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(16);
    expect(await current.evaluate(el => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth)).toBe(true);
    // The flow stacks top to bottom instead of left to right.
    const tops = await current.locator(".step").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(3);

    await page.getByRole("button", { name: "講稿" }).click();
    await expect(page.locator(".ct-notes")).toBeVisible();
    const stage = (await page.locator(".ct-stage").boundingBox())!;
    const panel = (await page.locator(".ct-notes").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(stage.y + stage.height - 2);
    expect(panel.width).toBe(390);
    await expectAt(page, "stage 4.3.1 +0");
  });
});
