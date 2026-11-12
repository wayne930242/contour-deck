/** contour-deck/host with the remote: the built ES modules as a site loads them, the remote imported on first use. */
import type { Page } from "@playwright/test";
import type { Host } from "../../src/astro/host.js";
import { expect, RELAY, test } from "./remote-helpers.js";

const PAGE = "/tests/fixtures/host.html";
const at = (page: Page) =>
  page.evaluate(() => {
    const deck = (window as unknown as { ctHosts: Host[] }).ctHosts[0].deck;
    return deck ? `${deck.state.mode} ${deck.state.block}.${deck.state.slide}.${deck.state.page} +${deck.state.step}` : "closed";
  });
/** Scripts of the remote the page has fetched so far. */
const remoteModules = (page: Page) =>
  page.evaluate(() => performance.getEntriesByType("resource").filter(entry => entry.name.includes("/dist/remote/")).map(entry => entry.name.split("/").pop()!));

test("without data-ct-remote or data-ct-relay the deck has no remote and loads none of it", async ({ page }) => {
  await page.goto(`${PAGE}?view=deck&at=1.1`);
  await expect.poll(() => at(page)).toBe("stage 1.1.1 +0");
  await expect(page.locator('[data-ct-act="remote"]')).toHaveCount(0);
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp")).toHaveCount(0);
  // Only the storage keys, which the host imports to know whether a session is to be continued.
  expect(await remoteModules(page)).toEqual(["store.js"]);
});

test("data-ct-relay: R loads the remote, a phone on the same page pairs and moves the deck", async ({ page, remote }) => {
  await page.goto(`${PAGE}?view=deck&at=1.1&relay=${encodeURIComponent(RELAY)}`);
  await expect.poll(() => at(page)).toBe("stage 1.1.1 +0");
  expect(await remoteModules(page)).toEqual(["store.js"]);
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp .ct-badge").first()).toHaveText("中繼已連線");
  // The built-in encoder came as its own module, and the views of the phone and the presenter did not come at all.
  await expect(page.locator(".ct-rp-img svg")).toHaveCount(2);
  const loaded = await remoteModules(page);
  expect(loaded).toContain("session.js");
  expect(loaded).toContain("qr.js");
  expect(loaded).not.toContain("phone.js");
  expect(loaded).not.toContain("presenter.js");

  const link = (await page.locator(".ct-rp-url").first().getAttribute("href"))!;
  expect(new URL(link).pathname).toBe(PAGE);
  const phone = await remote.phone(link);
  await expect(phone.locator(".ct-rmt-code")).toHaveText(await page.locator(".ct-rp-code").innerText());
  // While the view is open the wrapper is without its document classes, as for the deck.
  await expect(phone.locator("[data-ct-host]")).not.toHaveClass(/prose/);
  await page.getByRole("button", { name: "允許", exact: true }).click();
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("一 · 1/2 · 要點 0/2");
  await expect(phone.locator(".ct-rmt-time")).toHaveText("0:00 / 3:00");
  await expect(phone.locator(".ct-rmt-notes")).toHaveText("第一張的講稿。");
  await phone.getByRole("button", { name: "下一步" }).click();
  await expect.poll(() => at(page)).toBe("stage 1.1.1 +1");
  expect(await phone.evaluate(() => performance.getEntriesByType("resource").some(entry => entry.name.endsWith("/dist/remote/phone.js")))).toBe(true);

  // Leaving the deck closes the room; opening it again in this tab continues the session, and the phone is back.
  const room = await page.evaluate(() => new URL(document.querySelector<HTMLAnchorElement>(".ct-rp-url")!.href).searchParams.get("room")!);
  await page.keyboard.press("Escape");
  await page.locator('[data-ct-act="exit"]').click();
  await expect.poll(() => at(page)).toBe("closed");
  await expect(page.locator(".ct-laser")).toHaveCount(0);
  await expect.poll(() => remote.relay.rooms.has(room)).toBe(false);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "offline");
  await page.locator("#start").click();
  await expect.poll(() => remote.relay.rooms.has(room)).toBe(true);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted", { timeout: 20_000 });
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("輪廓");
});

test("configureRemote passes a site's own QR encoder, and data-ct-remote alone gives the presenter window", async ({ page, context }) => {
  await page.goto(`${PAGE}?view=deck&at=1.2&remote=1&qr=custom`);
  await page.locator('[data-ct-act="remote"]').click();
  await expect(page.locator(".ct-rp")).toContainText("沒有設定中繼服務");
  const custom = page.locator(".ct-rp-img svg[data-custom]");
  await expect(custom).toHaveCount(1);
  expect(decodeURIComponent((await custom.getAttribute("data-custom"))!)).toMatch(/host\.html\?remote=1&qr=custom&view=notes$/);
  expect(await remoteModules(page)).not.toContain("qr.js");

  const [presenter] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟講者視窗" }).click()]);
  await expect(presenter.locator(".ct-pr .ct-rmt-pos")).toHaveText("一 · 2/2");
  await expect(presenter.locator(".ct-pr-notes")).toHaveText("第二張的講稿。");
  await presenter.keyboard.press("ArrowLeft");
  await expect.poll(() => at(page)).toBe("stage 1.1.1 +2");
});
