/** The outline, its ring, the depth desk (the 3D outline), what was already shown, and the locator rail. */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { boxGap, DEMO, expectAt, frontRow, idle, openFromOutline, openGenerated, revealWithArrows, rowMatrix, thumb, wheelGesture } from "./helpers.js";

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

/** Opens the demo's outline with the ring on 三.4, the outline flat. */
async function outlineAt34(page: Page) {
  await page.goto(`${DEMO}?view=deck&at=4.4`);
  await expectAt(page, "stage 4.4.1 +0");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 4.4.1 +0");
}

test("the depth desk: the current block's row stands in front, flat and full size, the rows after it recede", async ({ page }) => {
  await outlineAt34(page);
  await page.keyboard.press("3");
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
  await expect(page.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
  expect(await frontRow(page)).toBe("三、翻頁怎麼運作");
  // In front: no rotation, no scaling, no depth.
  expect(await rowMatrix(page, 3)).toEqual({ m11: 1, m12: 0, m21: 0, m22: 1, m13: 0, m23: 0, m43: 0 });
  // Behind: further back the further on, still facing the viewer.
  const next = await rowMatrix(page, 4);
  const last = await rowMatrix(page, 6);
  expect(next.m43).toBeLessThan(0);
  expect(last.m43).toBeLessThan(next.m43);
  expect([next.m12, next.m21, next.m13, next.m23]).toEqual([0, 0, 0, 0]);
  // Behind is also smaller on screen, through the perspective.
  const width = (i: number) => page.locator(".ct-tile").nth(i).evaluate(el => el.getBoundingClientRect().width);
  expect(await width(4)).toBeLessThan(await width(3));
  // The pages of a slide in the front row stack in depth: a 2-page slide's face is one lift (12 px) up.
  const face = (label: string) => thumb(page, label).locator(".ct-face");
  await expect.poll(() => face("三、翻頁怎麼運作，第 4 張").evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m43)).toBe(12);
  // The ring stays on its thumbnail.
  await expect.poll(() => boxGap(page, ".ct-ring", '.ct-thumb[aria-label^="三、翻頁怎麼運作，第 4 張"] .ct-face')).toBeLessThanOrEqual(1);
  // End brings the appendix forward: its 4-page slide's face ends three lifts (36 px) up.
  await page.keyboard.press("End");
  await expect.poll(() => frontRow(page)).toBe("附錄（書面，會上不念）");
  await expect.poll(() => face("附錄（書面，會上不念），第 1 張").evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m43)).toBe(36);
  await page.getByRole("button", { name: "3D" }).click();
  await expect(page.locator(".ct-app")).not.toHaveAttribute("data-ct-3d");
  await expect(page.locator(".ct-tile").nth(3)).toHaveCSS("transform", "none");
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 760 },
]) {
  for (const blocks of [7, 20]) {
    test(`the depth desk shows the whole deck at once: ${blocks} blocks at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      if (blocks === 7) await page.goto(`${DEMO}?view=deck`);
      else await openGenerated(page, blocks);
      await expectAt(page, "overview 1.1.1 +0");
      await page.keyboard.press("3");
      await expect(page.locator(".ct-tile").first()).toHaveAttribute("data-ct-front", "");
      // Middle of the deck, so rows lie both before and after the front.
      await page.keyboard.press("End");
      for (let i = 0; i < Math.floor(blocks / 2); i++) await page.keyboard.press("ArrowUp");
      const front = blocks - 1 - Math.floor(blocks / 2);
      await expect(page.locator(".ct-tile").nth(front)).toHaveAttribute("data-ct-front", "");
      await expect.poll(() => rowMatrix(page, front).then(m => m.m43)).toBe(0);
      const fit = await page.evaluate(front => {
        const ov = document.querySelector(".ct-ov")!;
        const box = ov.getBoundingClientRect();
        const tiles = Array.from(document.querySelectorAll(".ct-tile")).map(el => el.getBoundingClientRect());
        const inside = (r: DOMRect) => r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
        return {
          front: inside(tiles[front]),
          // Every row from the front on is on screen; rows passed have slid out.
          ahead: tiles.slice(front).every(r => r.top >= box.top - 0.5 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
          // Each row behind shows above the one in front of it.
          stacked: tiles.slice(front + 1).every((r, i) => r.top < tiles[front + i].top),
          overflowX: ov.scrollWidth - ov.clientWidth,
          // The scroll range is one stop per row: the rows' transforms do not stretch it.
          range: ov.scrollHeight - ov.clientHeight,
        };
      }, front);
      expect(fit).toEqual({ front: true, ahead: true, stacked: true, overflowX: 0, range: (blocks - 1) * 120 });
    });
  }
}

test("on the depth desk the up and down keys, Home, End, and the focus change the row in front, never opening one", async ({ page }) => {
  await outlineAt34(page);
  await page.keyboard.press("3");
  await expect(thumb(page, "三、翻頁怎麼運作，第 4 張")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => frontRow(page)).toBe("四、在網站上使用");
  await expect(thumb(page, "四、在網站上使用，第 1 張")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => frontRow(page)).toBe("三、翻頁怎麼運作");
  // Back in the current block, the focus lands on the current slide.
  await expect(thumb(page, "三、翻頁怎麼運作，第 4 張")).toBeFocused();
  await page.keyboard.press("Home");
  await expect.poll(() => frontRow(page)).toBe("開場");
  await expect(thumb(page, "開場，第 1 張")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => frontRow(page)).toBe("開場");
  // Left and right keep the linear order; crossing into the next block brings its row forward.
  await page.keyboard.press("ArrowRight");
  await expect(thumb(page, "一、為什麼大綱優先，第 1 張")).toBeFocused();
  await expect.poll(() => frontRow(page)).toBe("一、為什麼大綱優先");
  // Tab into another row does the same.
  await thumb(page, "五、小結，第 1 張").focus();
  await expect.poll(() => frontRow(page)).toBe("五、小結");
  await expect(page.locator(".ct-tile").nth(5)).toHaveAttribute("data-ct-front", "");
  await expectAt(page, "overview 4.4.1 +0");
});

test("on the depth desk one wheel gesture moves one row", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await page.keyboard.press("3");
  await expect.poll(() => frontRow(page)).toBe("開場");
  await wheelGesture(page, 120);
  await expect.poll(() => frontRow(page)).toBe("一、為什麼大綱優先");
  await page.waitForTimeout(500);
  expect(await frontRow(page)).toBe("一、為什麼大綱優先");
  await page.waitForTimeout(200);
  await wheelGesture(page, 120);
  await expect.poll(() => frontRow(page)).toBe("二、三層結構");
  await page.waitForTimeout(500);
  await wheelGesture(page, -120);
  await expect.poll(() => frontRow(page)).toBe("一、為什麼大綱優先");
  await expectAt(page, "overview 1.1.1 +0");
});

test("on the depth desk a click on a row behind brings it forward; a click in front opens, and Esc comes back to the desk", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await page.keyboard.press("3");
  await expect.poll(() => frontRow(page)).toBe("開場");
  // By the mouse at the title on screen: locator.click() would first scroll the desk to the row's untransformed box.
  const title = (await page.locator(".ct-tile").nth(1).locator(".ct-tt").boundingBox())!;
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
  await expect.poll(() => frontRow(page)).toBe("一、為什麼大綱優先");
  await expectAt(page, "overview 1.1.1 +0");
  await expect.poll(() => rowMatrix(page, 1).then(m => m.m43)).toBe(0);
  await thumb(page, "一、為什麼大綱優先，第 3 張").click();
  await expectAt(page, "stage 2.3.1 +0");
  await idle(page);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.3.1 +0");
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-3d", "");
  expect(await frontRow(page)).toBe("一、為什麼大綱優先");
  await expect.poll(() => boxGap(page, ".ct-ring", '.ct-thumb[aria-label^="一、為什麼大綱優先，第 3 張"] .ct-face')).toBeLessThanOrEqual(1);
  await expect(thumb(page, "一、為什麼大綱優先，第 3 張")).toBeFocused();
});

test("with the depth desk on, a block change moves the camera forward one row, and the outline comes back on the new block", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.6`);
  await expectAt(page, "stage 4.6.1 +0");
  await page.keyboard.press("o");
  await expectAt(page, "overview 4.6.1 +0");
  await page.keyboard.press("3");
  await thumb(page, "三、翻頁怎麼運作，第 6 張").click();
  await expectAt(page, "stage 4.6.1 +0");
  await idle(page);
  // Watch the camera during the flight.
  await page.evaluate(() => {
    const plane = document.querySelector<HTMLElement>(".ct-plane")!;
    const seen: string[] = [];
    Object.assign(window, { cams: seen });
    const sample = () => {
      seen.push(plane.style.getPropertyValue("--ct-cam"));
      if (seen.length < 400) requestAnimationFrame(sample);
    };
    sample();
  });
  await revealWithArrows(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 5.1.1 +0");
  await idle(page);
  const cams = await page.evaluate(() => (window as unknown as { cams: string[] }).cams.map(Number));
  // From row 三 (3) to row 四 (4) through the positions in between.
  expect(cams[0]).toBe(3);
  expect(cams.some(cam => cam > 3 && cam < 4)).toBe(true);
  expect(cams.at(-1)).toBe(4);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 5.1.1 +0");
  expect(await frontRow(page)).toBe("四、在網站上使用");
  await expect.poll(() => boxGap(page, ".ct-ring", '.ct-thumb[aria-label^="四、在網站上使用，第 1 張"] .ct-face')).toBeLessThanOrEqual(1);
});

test("slides already shown and blocks finished are faded in the outline; the current slide is not", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.1`);
  await expectAt(page, "stage 1.1.1 +0");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.1.1 +0");
  await idle(page);
  await revealWithArrows(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.2.1 +0");
  await idle(page);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.2.1 +0");
  await expect(thumb(page, "開場，第 1 張")).toHaveAttribute("data-ct-seen", "");
  await expect(thumb(page, "一、為什麼大綱優先，第 1 張")).toHaveAttribute("data-ct-seen", "");
  await expect(thumb(page, "一、為什麼大綱優先，第 2 張")).toHaveAttribute("aria-current", "true");
  await expect(thumb(page, "一、為什麼大綱優先，第 3 張")).not.toHaveAttribute("data-ct-seen");
  // A finished block fades as a whole; the current one does not.
  await expect(page.locator(".ct-tile").first()).toHaveAttribute("data-ct-seen", "");
  await expect(page.locator(".ct-tile").nth(1)).not.toHaveAttribute("data-ct-seen");
  const ink = (label: string) => thumb(page, label).locator(".ct-t").evaluate(el => getComputedStyle(el).color);
  const fresh = await ink("一、為什麼大綱優先，第 3 張");
  expect(await ink("一、為什麼大綱優先，第 1 張")).not.toBe(fresh);
  expect(await ink("一、為什麼大綱優先，第 2 張")).toBe(fresh);
  // The same marks on the depth desk.
  await page.keyboard.press("3");
  await expect(thumb(page, "一、為什麼大綱優先，第 1 張")).toHaveAttribute("data-ct-seen", "");
  expect(await ink("一、為什麼大綱優先，第 1 張")).not.toBe(await ink("一、為什麼大綱優先，第 3 張"));
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
