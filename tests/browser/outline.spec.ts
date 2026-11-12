/** The outline, its ring, the 3D structure view, and the locator rail. */
import { expect, test } from "./fixtures.js";
import { boxGap, DEMO, expectAt, idle, openFromOutline, thumb } from "./helpers.js";

test("the outline lists every block with its slides, pages, and minutes", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await expect(page.locator(".ct-tile")).toHaveCount(7);
  await expect(page.locator(".ct-thumb")).toHaveCount(21);
  const third = page.locator(".ct-tile", { hasText: "三、翻頁怎麼運作" });
  await expect(third.locator(".ct-meta")).toHaveText("6 張 · 9 頁 · 約 5 分");
  await expect(page.locator(".ct-tile", { hasText: "開場" }).first().locator(".ct-meta")).toHaveText("1 張");
  const appendix = page.locator('.ct-tile[data-kind="appendix"]');
  await expect(appendix).toHaveCount(1);
  await expect(appendix.locator(".ct-badge")).toHaveText("書面");
  await expect(page.getByRole("button", { name: "三、翻頁怎麼運作，第 4 張：長頁怎麼停靠？，2 頁" })).toBeVisible();
  await expect(thumb(page, "三、翻頁怎麼運作，第 4 張").locator(".ct-num")).toHaveText("三.42 頁");
  // A slide is a stack of sheets, one per page.
  await expect(thumb(page, "三、翻頁怎麼運作，第 4 張").locator(".ct-layer")).toHaveCount(1);
  await expect(thumb(page, "附錄（書面，會上不念），第 1 張").locator(".ct-layer")).toHaveCount(3);
  await expect(thumb(page, "三、翻頁怎麼運作，第 1 張").locator(".ct-layer")).toHaveCount(0);
});

test("thumbnails are schematics of the first page, not copies of the content", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  const marks = (label: string) =>
    thumb(page, label)
      .locator(".ct-g")
      .evaluateAll(els => els.map(el => `${el.className.replace("ct-g ct-g-", "")}${el.children.length ? `:${el.children.length}` : ""}`));
  expect(await marks("一、為什麼大綱優先，第 2 張")).toEqual(["list"]);
  expect(await marks("一、為什麼大綱優先，第 3 張")).toEqual(["grid:3"]);
  expect(await marks("一、為什麼大綱優先，第 4 張")).toEqual(["text", "nums:2"]);
  expect(await marks("一、為什麼大綱優先，第 5 張")).toEqual(["text", "table"]);
  expect(await marks("三、翻頁怎麼運作，第 3 張")).toEqual(["flow:3", "text"]);
  expect(await marks("三、翻頁怎麼運作，第 1 張")).toEqual([]);
  // The content exists once: 34 pages, none inside the outline.
  await expect(page.locator("[data-ct-page]")).toHaveCount(34);
  await expect(page.locator(".ct-ov [data-ct-page]")).toHaveCount(0);
  await expect(page.locator("[data-ct-deck]")).toHaveCount(1);
});

test("back on the outline the ring sits on the slide just left, and focus returns to its thumbnail", async ({ page }) => {
  await openFromOutline(page, "三、翻頁怎麼運作，第 4 張", "stage 4.4.1 +0");
  await expect(page.locator(".ct-ov")).toHaveJSProperty("inert", true);
  await expect(page.locator(".ct-stage")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 4.5.1 +0");
  await idle(page);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 4.5.1 +0");
  await expect(page.locator(".ct-stage")).toHaveJSProperty("inert", true);
  await expect(page.locator(".ct-stage")).toBeHidden();
  const face = '.ct-thumb[aria-label^="三、翻頁怎麼運作，第 5 張"] .ct-face';
  await expect.poll(() => boxGap(page, ".ct-ring", face)).toBeLessThanOrEqual(1);
  await expect(thumb(page, "三、翻頁怎麼運作，第 5 張")).toBeFocused();
  await expect(page).toHaveURL(/[?&]view=deck$/);
});

test("the 3D structure view tilts the plane, stacks the pages, and still opens a slide", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  const plane = page.locator(".ct-plane");
  await expect(plane).toHaveCSS("transform", "none");
  await page.keyboard.press("3");
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
  await expect(page.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
  await expect(plane).toHaveCSS("transform", /^matrix3d/);
  // Each sheet is lifted along Z: the face of a 4-page slide ends three lifts (36 px) up.
  const face = thumb(page, "附錄（書面，會上不念），第 1 張").locator(".ct-face");
  await expect.poll(() => face.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m43)).toBe(36);
  await thumb(page, "三、翻頁怎麼運作，第 2 張").click();
  await expectAt(page, "stage 4.2.1 +0");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 4.2.1 +0");
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
  await page.getByRole("button", { name: "3D" }).click();
  await expect(page.locator(".ct-app")).not.toHaveAttribute("data-ct-3d");
});

test("the overview option opens the outline in 3D", async ({ page }) => {
  await page.goto(DEMO);
  await page.evaluate(() => window.contourDemo.open({ overview: "3d" }));
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
});

test("on the outline the arrow keys move between thumbnails and Enter opens one", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "overview 1.1.1 +0");
  // The outline opens with the focus on the current thumbnail.
  await expect(thumb(page, "開場，第 1 張")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(thumb(page, "一、為什麼大綱優先，第 2 張")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(thumb(page, "一、為什麼大綱優先，第 1 張")).toBeFocused();
  await page.keyboard.press("Enter");
  await expectAt(page, "stage 2.1.1 +0");
});

test("Space on the outline opens the current position, like the first press of a clicker", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "overview 1.1.1 +0");
  await page.keyboard.press("PageDown");
  await expectAt(page, "stage 1.1.1 +0");
});

test("the block heading opens the block at its first slide", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await page.locator(".ct-open", { hasText: "四、在網站上使用" }).click();
  await expectAt(page, "stage 5.1.1 +0");
});

test("the rail marker sits on the pip of the current page and every pip is a link", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4.2`);
  await expectAt(page, "stage 4.4.2 +0");
  await expect(page.locator(".ct-rc")).toHaveCount(21);
  await expect(page.locator(".ct-rc i")).toHaveCount(34);
  await expect.poll(() => boxGap(page, ".ct-rm", '.ct-rc i[data-ct-go="3,3,1"]')).toBeLessThanOrEqual(1);
  await expect(page.locator(".ct-rg[data-cur] .ct-rl")).toHaveText("三");

  // Same block: a scroll. The second pip of 三.2 is its second page.
  await page.locator('.ct-rc i[data-ct-go="3,1,1"]').click();
  await expectAt(page, "stage 4.2.2 +0");
  await idle(page);
  await expect.poll(() => boxGap(page, ".ct-rm", '.ct-rc i[data-ct-go="3,1,1"]')).toBeLessThanOrEqual(1);

  // Another block: a flight.
  await page.locator('.ct-rc i[data-ct-go="1,3,1"]').click();
  await expectAt(page, "stage 2.4.2 +0");
  await expect(page.locator(".ct-app")).not.toHaveAttribute("data-ct-busy");
  await expect.poll(() => boxGap(page, ".ct-rm", '.ct-rc i[data-ct-go="1,3,1"]')).toBeLessThanOrEqual(1);

  // From the outline the rail opens a block too.
  await page.keyboard.press("o");
  await expectAt(page, "overview 2.4.2 +0");
  await page.locator(".ct-rl", { hasText: "五" }).click();
  await expectAt(page, "stage 6.1.1 +0");
});

test("a position change is announced to assistive technology", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4`);
  await expect(page.locator(".ct-live")).toHaveText("三、翻頁怎麼運作 三 · 4/6 · 頁 1/2");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".ct-live")).toHaveText("三、翻頁怎麼運作 三 · 4/6 · 頁 2/2");
  await expect(page.locator(".ct-rail")).toHaveAttribute("aria-label", "整份簡報的位置");
});
