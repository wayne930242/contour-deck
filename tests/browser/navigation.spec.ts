/** DESIGN.md 原型驗證: the linear advance, stepping back, block changes, and where the main part ends. */
import { expect, test } from "./fixtures.js";
import { DEMO, expectAt, idle, openFromOutline, slideBox, where } from "./helpers.js";

test("the linear advance reveals steps, then moves to the next page, then the next slide", async ({ page }) => {
  // 三.2: page 1 holds four steps, page 2 none.
  await openFromOutline(page, "三、翻頁怎麼運作，第 2 張", "stage 4.2.1 +0");
  const steps = page.locator('[data-ct-slide][id="s-4-2"] [data-ct-step]');
  await expect(steps).toHaveCount(4);
  for (let shown = 1; shown <= 4; shown++) {
    await page.keyboard.press("Space");
    await expectAt(page, `stage 4.2.1 +${shown}`);
    await expect(steps.nth(shown - 1)).toHaveAttribute("data-ct-on", "");
    if (shown < 4) await expect(steps.nth(shown)).not.toHaveAttribute("data-ct-on");
  }
  await page.keyboard.press("Space");
  await expectAt(page, "stage 4.2.2 +0");
  await idle(page);
  await page.keyboard.press("Space");
  await expectAt(page, "stage 4.3.1 +0");
});

test("the linear advance walks down a tall page before it leaves the slide", async ({ page }) => {
  await openFromOutline(page, "三、翻頁怎麼運作，第 4 張", "stage 4.4.1 +0");
  // Hidden table rows take no space, so the page grows as its steps show: measure the end each time.
  const seen: string[] = [];
  let reachedEnd = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("PageDown");
    await idle(page);
    const now = await where(page);
    if (!now.startsWith("stage 4.4.")) {
      seen.push(now);
      break;
    }
    const box = await slideBox(page);
    const top = box.top;
    const end = box.height - box.viewport;
    reachedEnd ||= top === end;
    seen.push(`${now} @${top === end ? "end" : top}`);
  }
  // Page 2 top, its four steps (the view follows them down the page), its end, then the next slide.
  expect(seen[0]).toBe("stage 4.4.2 +0 @760");
  expect(seen.slice(1, 5).map(entry => entry.split(" @")[0])).toEqual(["stage 4.4.2 +1", "stage 4.4.2 +2", "stage 4.4.2 +3", "stage 4.4.2 +4"]);
  expect(reachedEnd).toBe(true);
  expect(seen.at(-1)).toBe("stage 4.5.1 +0");
});

test("stepping back hides the steps one at a time, then returns to the previous page and slide", async ({ page }) => {
  await openFromOutline(page, "三、翻頁怎麼運作，第 2 張", "stage 4.2.1 +0");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Space");
    await idle(page);
  }
  await expectAt(page, "stage 4.2.2 +0");

  await page.keyboard.press("Backspace");
  await expectAt(page, "stage 4.2.1 +4");
  await idle(page);
  for (let shown = 3; shown >= 0; shown--) {
    await page.keyboard.press("Shift+Space");
    await expectAt(page, `stage 4.2.1 +${shown}`);
  }
  await page.keyboard.press("PageUp");
  await expectAt(page, "stage 4.1.1 +0");
});

test("stepping back into a slide lands on its last page with every step shown", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.6`);
  await expectAt(page, "stage 2.6.1 +0");
  await page.keyboard.press("Backspace");
  // 一.5: two pages; page 1 has two steps.
  await expectAt(page, "stage 2.5.2 +0");
  await idle(page);
  await page.keyboard.press("Backspace");
  await expectAt(page, "stage 2.5.1 +2");
});

test("advancing past the last slide of a block flies to the next block (三.6 to 四.1)", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.6`);
  await expectAt(page, "stage 4.6.1 +0");
  for (let shown = 1; shown <= 4; shown++) {
    await page.keyboard.press("Space");
    await expectAt(page, `stage 4.6.1 +${shown}`);
  }
  await page.keyboard.press("Space");
  // Mid-flight both layers show: the outline behind, the stage zooming.
  await expect(page.locator(".ct-app")).toHaveAttribute("data-ct-busy", "");
  await expect(page.locator(".ct-ov")).toBeVisible();
  await expectAt(page, "stage 5.1.1 +0");
  await expect(page.locator(".ct-app")).not.toHaveAttribute("data-ct-busy");
  await expect(page).toHaveURL(/at=5\.1\.1$/);
  await expect(page.locator('[data-ct-block][data-ct-active]')).toHaveAttribute("data-title", "四、在網站上使用");
  await expect(page.locator(".ct-title")).toHaveText("四、在網站上使用");
});

test("the left arrow on 附.1 flies back to 五.2", async ({ page }) => {
  await openFromOutline(page, "附錄（書面，會上不念），第 1 張", "stage 7.1.1 +0");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 6.2.1 +0");
});

test("the main part ends at 五.2: neither the advance nor the right arrow enters the appendix", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=6.2`);
  await expectAt(page, "stage 6.2.1 +0");
  for (const key of ["Space", "PageDown", "Enter", "ArrowRight"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    await expectAt(page, "stage 6.2.1 +0");
  }
  await page.locator('.ct-ctl [data-ct-act="next"]').click();
  await page.evaluate(() => window.contourDemo.deck!.next());
  await page.waitForTimeout(1500);
  await expectAt(page, "stage 6.2.1 +0");
  await expect(page.locator(".ct-app")).not.toHaveAttribute("data-ct-busy");
});

test("inside the appendix the advance moves through its slides and stops at its end", async ({ page }) => {
  await openFromOutline(page, "附錄（書面，會上不念），第 4 張", "stage 7.4.1 +0");
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await expectAt(page, "stage 7.4.1 +0");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 7.3.1 +0");
  await idle(page);
  await page.keyboard.press("Space");
  await expectAt(page, "stage 7.3.2 +0");
});

test("arrows, Home and End move between slides; a later slide waits unrevealed, an earlier one stays revealed", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.2`);
  await expectAt(page, "stage 2.2.1 +0");
  await page.keyboard.press("Space");
  await expectAt(page, "stage 2.2.1 +1");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.3.1 +0");
  await idle(page);
  await page.keyboard.press("ArrowLeft");
  // Coming back from the right, the slide is fully revealed.
  await expectAt(page, "stage 2.2.1 +3");
  await idle(page);
  await page.keyboard.press("End");
  await expectAt(page, "stage 2.6.1 +0");
  await idle(page);
  await page.keyboard.press("Home");
  await expectAt(page, "stage 2.1.1 +0");
  await idle(page);
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 1.1.1 +0");
});

test("the on-screen step buttons advance and go back", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.2`);
  await expectAt(page, "stage 2.2.1 +0");
  await page.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  await page.getByRole("button", { name: "上一步" }).click();
  await expectAt(page, "stage 2.2.1 +0");
});

test("the API drives the deck the way a remote will: next, prev, go, open, overview", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "overview 1.1.1 +0");
  const call = (code: string) => page.evaluate(`(async () => { const deck = window.contourDemo.deck; await (${code}); })()`);
  await call('deck.open("2.2")');
  await expectAt(page, "stage 2.2.1 +0");
  await call("deck.next()");
  await expectAt(page, "stage 2.2.1 +1");
  await call("deck.prev()");
  await expectAt(page, "stage 2.2.1 +0");
  await call('deck.go("2.4.2")');
  await expectAt(page, "stage 2.4.2 +0");
  await idle(page);
  await call('deck.go("4.4.2")');
  await expectAt(page, "stage 4.4.2 +0");
  await call('deck.go("s-6-2")');
  await expectAt(page, "stage 6.2.1 +0");
  await call('deck.go("99.1")');
  await expectAt(page, "stage 6.2.1 +0");
  await call("deck.overview()");
  await expectAt(page, "overview 6.2.1 +0");
  await call("deck.next()");
  await expectAt(page, "stage 6.2.1 +0");
});

test("change listeners hear every move once, with the URL form of the position", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.2`);
  await expectAt(page, "stage 2.2.1 +0");
  await page.evaluate(() => {
    const log: string[] = ((window as unknown as { log: string[] }).log = []);
    window.contourDemo.deck!.on("change", change => log.push(`${change.mode} ${change.at} +${change.step}`));
  });
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expectAt(page, "stage 2.2.1 +2");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.3.1 +0");
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { log: string[] }).log)).toEqual([
    "stage 2.2.1 +1",
    "stage 2.2.1 +2",
    "stage 2.3.1 +0",
  ]);
});
