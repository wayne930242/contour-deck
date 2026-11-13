/** Document and deck, deep links, page events, reduced motion, file://, and free paging. */
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "./fixtures.js";
import { DEMO, expectAt, idle, revealWithArrows, slideBox, thumb, watchTransition, where } from "./helpers.js";

const RUNTIME = "[data-ct-on],[data-ct-active],[data-ct-current],[data-ct-open]";

test("without the script's deck the page is a document: every page in order, notes hidden, steps shown", async ({ page }) => {
  await page.goto(DEMO);
  await expect(page.locator(".ct-app")).toHaveCount(0);
  await expect(page.locator("[data-ct-page]")).toHaveCount(34);
  await expect(page.locator("[data-ct-notes]").first()).toBeHidden();
  await expect(page.locator("[data-ct-step]").first()).toBeVisible();
  await expect(page.locator("[data-ct-step]").first()).toHaveCSS("opacity", "1");
  expect(await where(page)).toBe("closed");
});

test("START opens the same nodes as a deck; Esc on the outline puts the document back untouched", async ({ page }) => {
  await page.goto(`${DEMO}?ref=mail`);
  await page.evaluate(() => {
    const root = document.querySelector("[data-ct-deck]")!;
    Object.assign(window, { rootBefore: root, pageBefore: root.querySelector("[data-ct-page]") });
  });
  await page.getByRole("button", { name: "START" }).click();
  await expectAt(page, "overview 1.1.1 +0");
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { rootBefore: Element; pageBefore: Element };
      return (
        document.querySelector(".ct-stage > [data-ct-deck]") === w.rootBefore &&
        document.querySelector("[data-ct-page]") === w.pageBefore &&
        document.querySelectorAll("[data-ct-deck]").length === 1
      );
    })
  ).toBe(true);
  await expect(page).toHaveURL(/\?ref=mail&view=deck$/);
  await expect(page.locator("html")).toHaveAttribute("data-ct-open", "");

  await thumb(page, "一、為什麼大綱優先，第 2 張").click();
  await expectAt(page, "stage 2.2.1 +0");
  await page.keyboard.press("Space");
  await expectAt(page, "stage 2.2.1 +1");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 2.2.1 +1");
  await page.keyboard.press("Escape");

  await expect(page.locator(".ct-app")).toHaveCount(0);
  expect(await where(page)).toBe("closed");
  await expect(page.locator(RUNTIME)).toHaveCount(0);
  await expect(page).toHaveURL(/\?ref=mail$/);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { rootBefore: Element };
      const root = document.querySelector("[data-ct-deck]")!;
      return root === w.rootBefore && root.parentElement!.matches("main.doc") && root.previousElementSibling!.matches(".doc-head");
    })
  ).toBe(true);
  await expect(page.locator("[data-ct-step]").first()).toHaveCSS("opacity", "1");

  // And it opens again.
  await page.getByRole("button", { name: "START" }).click();
  await expectAt(page, "overview 1.1.1 +0");
  await expect(page.locator(".ct-app")).toHaveCount(1);
});

test("opening moves the focus into the shell, so the keys reach the deck and not the START button", async ({ page }) => {
  await page.goto(DEMO);
  await page.getByRole("button", { name: "START" }).click();
  await expectAt(page, "overview 1.1.1 +0");
  await expect(thumb(page, "開場，第 1 張")).toBeFocused();
  await page.keyboard.press("Enter");
  await expectAt(page, "stage 1.1.1 +0");
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 1.1.1 +0");
  await page.getByRole("button", { name: "提詞" }).click();
  await expect(page.locator(".ct-script")).toBeFocused();

  await page.goto(`${DEMO}?view=notes`);
  await expect(page.locator(".ct-script")).toBeFocused();
});

test("the close button of the bar leaves the deck from the outline, the stage, and the notes view", async ({ page }) => {
  for (const url of [`${DEMO}?view=deck`, `${DEMO}?view=deck&at=4.4.2`, `${DEMO}?view=notes`]) {
    await page.goto(url);
    await expect(page.locator(".ct-app")).toHaveCount(1);
    await idle(page);
    await page.getByRole("button", { name: "離開簡報" }).click();
    await expect(page.locator(".ct-app")).toHaveCount(0);
    expect(await where(page)).toBe("closed");
    await expect(page.locator(RUNTIME)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${DEMO.replace(".", "\\.")}$`));
  }
});

test("HTML that breaks the contract is refused before anything is mounted", async ({ page }) => {
  await page.goto(DEMO);
  const messages = await page.evaluate(() => {
    const create = (window as unknown as { ContourDeck: { createDeck(root: HTMLElement): unknown } }).ContourDeck.createDeck;
    return ["<div data-ct-deck></div>", "<div data-ct-deck><section data-ct-block></section></div>", "<div data-ct-deck><section data-ct-block><section data-ct-slide></section></section></div>"].map(html => {
      const holder = document.createElement("div");
      holder.innerHTML = html;
      document.body.append(holder);
      try {
        create(holder.firstElementChild as HTMLElement);
        return "no error";
      } catch (error) {
        return (error as Error).message;
      } finally {
        holder.remove();
      }
    });
  });
  expect(messages).toEqual([
    "contour-deck: the deck has no [data-ct-block] child (see docs/CONTRACT.md)",
    "contour-deck: block 1 has no [data-ct-slide] child (see docs/CONTRACT.md)",
    "contour-deck: slide 1.1 has no [data-ct-page] child (see docs/CONTRACT.md)",
  ]);
  await expect(page.locator(".ct-app")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-ct-open");
});

test("a deep link opens the stage at block.slide.page, by ordinals or by element id", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4.2`);
  await expectAt(page, "stage 4.4.2 +0");
  expect((await slideBox(page)).top).toBe(760);
  await expect(page.locator("[data-ct-block][data-ct-active]")).toHaveAttribute("data-title", "三、翻頁怎麼運作");
  await expect(page.locator(".ct-stage")).toBeFocused();

  await page.goto(`${DEMO}?view=deck&at=4.4`);
  await expectAt(page, "stage 4.4.1 +0");
  await page.goto(`${DEMO}?view=deck&at=s-4-4`);
  await expectAt(page, "stage 4.4.1 +0");
  await page.goto(`${DEMO}?view=deck&at=tradeoff`);
  await expectAt(page, "stage 4.5.1 +0");
  await page.goto(`${DEMO}?view=deck&at=4.4.9`);
  await expectAt(page, "stage 4.4.2 +0");
});

test("a position that does not exist opens the outline", async ({ page }) => {
  for (const at of ["99.1", "4.99", "0.1", "nowhere", "start"]) {
    await page.goto(`${DEMO}?view=deck&at=${at}`);
    await expectAt(page, "overview 1.1.1 +0");
  }
});

test("the URL follows the position", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4`);
  await expect(page).toHaveURL(/view=deck&at=4\.4\.1$/);
  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(/view=deck&at=4\.4\.2$/);
  await idle(page);
  await revealWithArrows(page);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/view=deck&at=4\.5\.1$/);
  await idle(page);
  // A reload lands where the URL says.
  await page.reload();
  await expectAt(page, "stage 4.5.1 +0");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/[?&]view=deck$/);
});

test("a page hears ct:enter when it becomes current and ct:leave when it stops", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck`);
  const events = () => page.evaluate(() => window.contourDemo.events);
  expect(await events()).toEqual([]);
  await thumb(page, "三、翻頁怎麼運作，第 4 張").click();
  await expectAt(page, "stage 4.4.1 +0");
  expect(await events()).toEqual(["ct:enter 4.4.1"]);
  await expect(page.locator("[data-ct-current]")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expectAt(page, "stage 4.4.2 +0");
  await idle(page);
  expect(await events()).toEqual(["ct:enter 4.4.1", "ct:leave 4.4.1", "ct:enter 4.4.2"]);
  // Revealing a step is not a page change.
  await page.keyboard.press("Space");
  await expectAt(page, "stage 4.4.2 +1");
  expect(await events()).toHaveLength(3);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 4.4.2 +1");
  expect(await events()).toEqual(["ct:enter 4.4.1", "ct:leave 4.4.1", "ct:enter 4.4.2", "ct:leave 4.4.2"]);
  await expect(page.locator("[data-ct-current]")).toHaveCount(0);
});

test("a jump across several slides enters only the slide it lands on", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.1`);
  await expectAt(page, "stage 2.1.1 +0");
  await page.keyboard.press("End");
  await expectAt(page, "stage 2.6.1 +0");
  await idle(page);
  expect(await page.evaluate(() => window.contourDemo.events)).toEqual(["ct:enter 2.1.1", "ct:leave 2.1.1", "ct:enter 2.6.1"]);
  // The slides in between were passed over, and wait at their top with their steps hidden.
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 2.5.1 +2");
});

test("transitions are as long as the budget allows: open and close under 0.55 s, a block change under 1.3 s", async ({ page }) => {
  // The lengths asserted are the configured ones; wall-clock time on a loaded test machine is only bounded loosely.
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "overview 1.1.1 +0");
  const open = await watchTransition(page, "Enter");
  expect(open.animations).toEqual([520]);
  await expectAt(page, "stage 1.1.1 +0");
  // Zoom out 360 ms, 400 ms for the ring to travel, zoom in 460 ms: 1220 ms.
  const fly = await watchTransition(page, "ArrowRight");
  expect(fly.animations).toEqual([360, 460]);
  expect(fly.elapsed).toBeGreaterThan(360 + 400 + 460 - 50);
  expect(fly.elapsed).toBeLessThan(3000);
  await expectAt(page, "stage 2.1.1 +0");
  const close = await watchTransition(page, "Escape");
  expect(close.animations).toEqual([480]);
  await expectAt(page, "overview 2.1.1 +0");
});

test("destroy on the stage sends ct:leave to the current page", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=2.1`);
  await expectAt(page, "stage 2.1.1 +0");
  await page.evaluate(() => window.contourDemo.close());
  expect(await page.evaluate(() => window.contourDemo.events)).toEqual(["ct:enter 2.1.1", "ct:leave 2.1.1"]);
  await expect(page.locator(RUNTIME)).toHaveCount(0);
  await expect(page).toHaveURL(/index\.html$/);
});

test.describe("with prefers-reduced-motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a block change completes within 0.7 s and lands in place", async ({ page }) => {
    await page.goto(`${DEMO}?view=deck&at=4.6`);
    await expectAt(page, "stage 4.6.1 +0");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await revealWithArrows(page);
    const { elapsed, animations } = await watchTransition(page, "ArrowRight");
    expect(animations).toEqual([140]);
    expect(elapsed).toBeLessThan(700);
    await expectAt(page, "stage 5.1.1 +0");
    await expect(page.locator("[data-ct-block][data-ct-active]")).toHaveAttribute("data-title", "四、在網站上使用");
    await expect(page.locator(".ct-stage")).toHaveCSS("opacity", "1");
  });

  test("steps between stops jump instead of gliding, and opening and closing fade", async ({ page }) => {
    await page.goto(`${DEMO}?view=deck&at=4.4`);
    await expectAt(page, "stage 4.4.1 +0");
    const top = await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      return document.querySelector("[data-ct-current]")!.parentElement!.scrollTop;
    });
    expect(top).toBe(760);
    const started = Date.now();
    await page.keyboard.press("Escape");
    await expectAt(page, "overview 4.4.2 +0");
    // The depth desk and its rows change within the frame of the key press.
    const rows = await page.evaluate(() => {
      const key = (name: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
      const front = () => document.querySelector(".ct-tile[data-ct-front] .ct-tt")?.textContent;
      const cam = () => document.querySelector<HTMLElement>(".ct-plane")!.style.getPropertyValue("--ct-cam");
      key("3");
      const on = [front(), cam()];
      key("ArrowDown");
      return [...on, front(), cam()];
    });
    expect(rows).toEqual(["三、翻頁怎麼運作", "3", "四、在網站上使用", "4"]);
    await page.keyboard.press("ArrowUp");
    await thumb(page, "三、翻頁怎麼運作，第 2 張").click();
    await expectAt(page, "stage 4.2.1 +0");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

test("the demo opens and advances straight from the file system", async ({ page }) => {
  const file = pathToFileURL(fileURLToPath(new URL("../../demo/index.html", import.meta.url))).href;
  await page.goto(file);
  await page.getByRole("button", { name: "START" }).click();
  await expectAt(page, "overview 1.1.1 +0");
  await thumb(page, "一、為什麼大綱優先，第 2 張").click();
  await expectAt(page, "stage 2.2.1 +0");
  await page.keyboard.press("Space");
  await expectAt(page, "stage 2.2.1 +1");
  await revealWithArrows(page);
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.3.1 +0");

  await page.goto(`${file}?view=deck&at=4.4.2`);
  await expectAt(page, "stage 4.4.2 +0");
  await page.keyboard.press("PageDown");
  await expectAt(page, "stage 4.4.2 +1");
});

test("paging: free leaves the wheel to the browser; the default takes it over", async ({ page }) => {
  const prevented = async (url: string) => {
    await page.goto(url);
    await expectAt(page, "stage 4.4.1 +0");
    await page.evaluate(() => {
      Object.assign(window, { wheelPrevented: null });
      window.addEventListener("wheel", event => Object.assign(window, { wheelPrevented: event.defaultPrevented }));
    });
    await page.mouse.move(600, 420);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => (window as unknown as { wheelPrevented: boolean | null }).wheelPrevented)).not.toBeNull();
    return page.evaluate(() => (window as unknown as { wheelPrevented: boolean }).wheelPrevented);
  };
  expect(await prevented(`${DEMO}?view=deck&at=4.4`)).toBe(true);
  expect(await prevented(`${DEMO}?view=deck&at=4.4&paging=free`)).toBe(false);
  // Proximity is the default strictness, so the computed value is the bare axis.
  await expect(page.locator("[data-ct-current]").locator("xpath=..")).toHaveCSS("scroll-snap-type", "y");
});

test("touch scrolling is left to CSS scroll snap: one slide per swipe, one page per swipe", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=4.4`);
  await expectAt(page, "stage 4.4.1 +0");
  const slide = page.locator("[data-ct-current]").locator("xpath=..");
  await expect(page.locator("[data-ct-block][data-ct-active]")).toHaveCSS("scroll-snap-type", "x mandatory");
  await expect(slide).toHaveCSS("scroll-snap-type", "y mandatory");
  await expect(slide).toHaveCSS("scroll-snap-stop", "always");
  await expect(slide).toHaveCSS("scroll-snap-align", "start");
  await expect(page.locator("[data-ct-current]")).toHaveCSS("scroll-snap-stop", "always");
  // A native scroll, as a swipe produces, moves the position: scroll is the source of truth.
  await page.locator("[data-ct-block][data-ct-active]").evaluate(el => el.scrollTo({ left: el.clientWidth * 4, behavior: "smooth" }));
  await expectAt(page, "stage 4.5.1 +0");
});
