/** Page backgrounds: the still in the document, the video and the YouTube embed only on the current page of the stage. */
import { expect, test } from "./fixtures.js";
import { expectAt } from "./helpers.js";

const DEMO = "/demo/background.html";

/**
 * Stands in for the YouTube player: answers the API's commands over postMessage the way the embed does,
 * reports playing once it is told to listen, and records every command it gets.
 */
const PLAYER = `<!doctype html><body style="margin:0;background:#2a9d8f"><script>
  window.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    parent.postMessage(JSON.stringify({ event: "stub", info: data }), "*");
    if (data.event === "listening") {
      parent.postMessage(JSON.stringify({ event: "onReady" }), "*");
      parent.postMessage(JSON.stringify({ event: "onStateChange", info: 1 }), "*");
      setTimeout(() => parent.postMessage(JSON.stringify({ event: "onStateChange", info: 0 }), "*"), 300);
    }
  });
</script></body>`;

test.beforeEach(async ({ page }) => {
  await page.route("https://www.youtube-nocookie.com/**", route =>
    route.fulfill({ status: 200, contentType: "text/html", body: PLAYER })
  );
  await page.addInitScript(() => {
    const seen: unknown[] = [];
    Object.assign(window, { stubSeen: seen });
    window.addEventListener("message", event => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.event === "stub") seen.push(data.info);
      } catch {
        // not the stub's
      }
    });
  });
});

const media = (page: import("@playwright/test").Page) => page.locator("[data-ct-background] > .ct-bgm");

test("closed, the deck shows each background's still as a picture and plays nothing", async ({ page }) => {
  await page.goto(DEMO);
  await expect(page.locator("[data-ct-background] > img")).toHaveCount(5);
  await expect(page.locator("[data-ct-background] > img").first()).toBeVisible();
  await expect(page.locator("video, iframe")).toHaveCount(0);
});

test("an image fills the stage behind a dark scrim, and the page's text turns light", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.1`);
  await expectAt(page, "stage 1.1.1 +0");
  const box = page.locator("#image [data-ct-background]");
  const stage = await page.locator(".ct-stage").boundingBox();
  const bg = await box.boundingBox();
  expect(Math.round(bg!.width)).toBe(Math.round(stage!.width - 2));
  expect(bg!.height).toBeGreaterThanOrEqual(stage!.height - 2);
  await expect(page.locator("#image [data-ct-background] > img")).toHaveCSS("object-fit", "cover");
  const scrim = await box.evaluate(el => getComputedStyle(el, "::after").backgroundColor);
  expect(scrim).toBe("rgba(0, 0, 0, 0.6)");
  await expect(page.locator("#image h2")).toHaveCSS("color", "rgb(242, 242, 237)");
  // The content stands over the background, not under it.
  const top = await page.evaluate(() => {
    const h2 = document.querySelector("#image h2")!.getBoundingClientRect();
    return document.elementFromPoint(h2.left + 4, h2.top + h2.height / 2)?.closest("h2") !== null;
  });
  expect(top).toBe(true);
  // The credit sits in the bottom left corner, over the scrim, clear of the step buttons on the right.
  const credit = (await page.locator("#image [data-ct-credit]").boundingBox())!;
  expect(credit.y + credit.height).toBeGreaterThan(stage!.y + stage!.height - 40);
  expect(credit.x).toBeLessThan(stage!.x + 40);
  await expect(page.locator("#image [data-ct-credit]")).toHaveText("漸層：ffmpeg gradients, CC0");
  await expect(media(page)).toHaveCount(0);
});

test("a video file plays muted only on its page, the poster fades once it plays, and leaving removes it", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.2`);
  await expectAt(page, "stage 1.2.1 +0");
  const video = page.locator("#video video.ct-bgm");
  await expect(video).toHaveCount(1);
  expect(await video.evaluate((el: HTMLVideoElement) => [el.muted, el.controls, el.playsInline, el.loop])).toEqual([true, false, true, false]);
  await expect(video).toHaveAttribute("data-ct-playing", "", { timeout: 8000 });
  await expect(page.locator("#video [data-ct-background] > img")).toHaveCSS("opacity", "0");
  // It loops between start (1 s) and end (4 s).
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 8000 }).toBeGreaterThan(3);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 8000 }).toBeLessThan(2);
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThanOrEqual(1);

  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 1.3.1 +0");
  await expect(page.locator("video")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectAt(page, "overview 1.3.1 +0");
  await expect(media(page)).toHaveCount(0);
});

test("YouTube mounts a no-cookie embed only for its page and loops it from start over postMessage", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.3`);
  await expectAt(page, "stage 1.3.1 +0");
  const frame = page.locator("#youtube iframe.ct-bgm");
  await expect(frame).toHaveCount(1);
  const src = new URL((await frame.getAttribute("src"))!);
  expect(src.origin + src.pathname).toBe("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ");
  expect(Object.fromEntries(src.searchParams)).toMatchObject({ mute: "1", controls: "0", rel: "0", disablekb: "1", cc_load_policy: "0", start: "30" });
  expect(src.searchParams.has("end")).toBe(false);
  await expect(frame).toHaveCSS("pointer-events", "none");
  expect(await frame.getAttribute("tabindex")).toBe("-1");
  // The still stays over YouTube's bezel for the first seconds of playback.
  await expect(page.locator("#youtube [data-ct-background] > img")).toHaveCSS("opacity", "1");
  await expect(frame).toHaveAttribute("data-ct-playing", "", { timeout: 8000 });
  await expect(page.locator("#youtube [data-ct-background] > img")).toHaveCSS("opacity", "0");
  // Scaled past cover: wider and taller than the stage.
  const stage = (await page.locator(".ct-stage").boundingBox())!;
  const box = (await frame.boundingBox())!;
  expect(box.width).toBeGreaterThan(stage.width);
  expect(box.height).toBeGreaterThan(stage.height);
  // The stub ends the clip; the deck seeks back to start and plays.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { stubSeen: { func?: string; args?: unknown[] }[] }).stubSeen))
    .toContainEqual(expect.objectContaining({ func: "seekTo", args: [30, true] }));
  // Captions are unloaded on ready and again after the loop.
  const unloads = await page.evaluate(() =>
    (window as unknown as { stubSeen: { func?: string; args?: unknown[] }[] }).stubSeen.filter(m => m.func === "unloadModule").map(m => m.args?.[0])
  );
  expect(unloads.filter(name => name === "captions").length).toBeGreaterThanOrEqual(2);
  expect(unloads).toContain("cc");

  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "stage 1.2.1 +0");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("on a page taller than the stage the media and the credit stay on screen while it scrolls", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.4`);
  await expectAt(page, "stage 1.4.1 +0");
  const stage = (await page.locator(".ct-stage").boundingBox())!;
  const slide = page.locator("#tall");
  expect(await slide.evaluate(el => el.scrollHeight > el.clientHeight * 1.5)).toBe(true);
  for (const where of ["top", "middle", "bottom"]) {
    await slide.evaluate((el, at) => {
      el.style.scrollSnapType = "none";
      el.scrollTop = at === "top" ? 0 : at === "middle" ? (el.scrollHeight - el.clientHeight) / 2 : el.scrollHeight;
    }, where);
    await page.waitForTimeout(100);
    const still = (await page.locator("#tall [data-ct-background] > img").boundingBox())!;
    expect(Math.abs(still.y - stage.y), where).toBeLessThan(3);
    expect(Math.abs(still.height - (stage.height - 2)), where).toBeLessThan(3);
    const credit = (await page.locator("#tall [data-ct-credit]").boundingBox())!;
    expect(credit.y + credit.height, where).toBeLessThanOrEqual(stage.y + stage.height);
    expect(credit.y + credit.height, where).toBeGreaterThan(stage.y + stage.height - 40);
  }
  const video = (await page.locator("#tall video.ct-bgm").boundingBox())!;
  expect(Math.abs(video.y - stage.y)).toBeLessThan(3);
});

test("a video whose start is past its end plays from 0 instead of seeking forever", async ({ page }) => {
  await page.goto(DEMO);
  await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("#video [data-ct-background]")!;
    box.dataset.start = "10";
    delete box.dataset.end;
    window.contourDemo.open({ at: "1.2" });
  });
  await expectAt(page, "stage 1.2.1 +0");
  const video = page.locator("#video video.ct-bgm");
  await expect(video).toHaveAttribute("data-ct-playing", "", { timeout: 8000 });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 8000 }).toBeGreaterThan(1);
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeLessThan(6);
});

test("a YouTube start past the video's end loops from 0", async ({ page }) => {
  await page.route("https://www.youtube-nocookie.com/**", route =>
    route.fulfill({ status: 200, contentType: "text/html", body: PLAYER.replace('{ event: "onStateChange", info: 1 }', '{ event: "infoDelivery", info: { duration: 20, playerState: 0 } }') })
  );
  await page.goto(`${DEMO}?view=deck&at=1.3`);
  await expectAt(page, "stage 1.3.1 +0");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { stubSeen: { func?: string; args?: unknown[] }[] }).stubSeen))
    .toContainEqual(expect.objectContaining({ func: "seekTo", args: [0, true] }));
});

test(":en lines sit small and muted under the Chinese, light over a background, whole with their step", async ({ page }) => {
  await page.goto(`${DEMO}?view=deck&at=1.6`);
  await expectAt(page, "stage 1.6.1 +0");
  const size = (selector: string) => page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const alone = page.locator("#bilingual p > .en");
  await expect(alone).toHaveCSS("display", "block");
  await expect(alone).toHaveCSS("font-weight", "400");
  // Over the scrim it takes the light muted colour of the page with a background.
  await expect(alone).toHaveCSS("color", "rgb(201, 201, 195)");
  const p = await size("#bilingual p");
  expect((await size("#bilingual p > .en")) / p).toBeCloseTo(0.8, 2);
  expect((await size("#bilingual li .en >> nth=0")) / (await size("#bilingual li >> nth=0"))).toBeCloseTo(0.62, 2);
  expect((await size("#bilingual td .en")) / (await size("#bilingual td"))).toBeCloseTo(0.62, 2);
  // A step shows its Chinese and English together.
  await expect(page.locator("#bilingual li").first()).toHaveCSS("opacity", "0");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 1.6.1 +1");
  await expect(page.locator("#bilingual li").first()).toHaveCSS("opacity", "1");
  await expect(page.locator("#bilingual li .en").first()).toBeVisible();

  await page.goto(`${DEMO}?view=deck&at=1.7`);
  await expectAt(page, "stage 1.7.1 +0");
  const kicker = page.locator("#bilingual-plain h4 .en");
  await expect(kicker).toHaveCSS("text-transform", "none");
  await expect(kicker).toHaveCSS("font-weight", "400");
  // Without a background it takes the deck's muted colour, not the text colour.
  const [en, h2] = await Promise.all([
    page.locator("#bilingual-plain p > .en").evaluate(el => getComputedStyle(el).color),
    page.locator("#bilingual-plain h2").evaluate(el => getComputedStyle(el).color),
  ]);
  expect(en).not.toBe(h2);
});

test("closed, the document shows each :en line under its Chinese", async ({ page }) => {
  await page.goto(DEMO);
  await expect(page.locator("#bilingual li .en").first()).toHaveCSS("display", "block");
  await expect(page.locator("#bilingual li .en").first()).toBeVisible();
});

test("with reduced motion the poster stays and nothing plays", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${DEMO}?view=deck&at=1.2`);
  await expectAt(page, "stage 1.2.1 +0");
  await expect(media(page)).toHaveCount(0);
  await expect(page.locator("#video [data-ct-background] > img")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "stage 1.3.1 +0");
  await expect(media(page)).toHaveCount(0);
});

test("a video that fails to load leaves the poster", async ({ page }) => {
  await page.route("**/bg/clip.webm", route => route.fulfill({ status: 200, contentType: "video/webm", body: "not a video" }));
  await page.goto(`${DEMO}?view=deck&at=1.2`);
  await expectAt(page, "stage 1.2.1 +0");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator("#video [data-ct-background] > img")).toHaveCSS("opacity", "1");
});
