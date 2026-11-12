/** The presenter window on the same computer, and tilt pointing with its calibration, fed fixed sensor readings. */
import type { BrowserContext } from "@playwright/test";
import { expectAt, idle } from "./helpers.js";
import { expect, expectLaser, test, tiltTo } from "./remote-helpers.js";

test("the presenter window follows the deck over BroadcastChannel, without a relay", async ({ page, context, remote }) => {
  await page.goto("/demo/index.html?view=deck&at=2.2");
  await page.keyboard.press("r");
  const [presenter] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟講者視窗" }).click()]);
  await expect(presenter).toHaveURL(/[?&]view=presenter&room=[0-9A-HJKMNP-TV-Z]{26}$/);
  const position = presenter.locator(".ct-pr .ct-rmt-pos");
  await expect(position).toHaveText("一 · 2/6 · 要點 0/3");
  await expect(presenter.locator(".ct-pr-notes")).toContainText("設計原則有三條");
  await expect(presenter.locator(".ct-rmt-time")).toHaveText("0:00 / 12:00");
  // Now: the page as it stands, no step shown yet. Next: the same page with its first step.
  const now = presenter.locator(".ct-pr-cell").first();
  const next = presenter.locator(".ct-pr-cell[data-next]");
  await expect(now.locator("h2 span")).toHaveText("三個設計原則");
  await expect(now.locator(".ct-pv [data-ct-step][data-ct-on]")).toHaveCount(0);
  await expect(next.locator("h2 span")).toContainText("要點｜內容只存在一份");
  await expect(next.locator(".ct-pv [data-ct-step][data-ct-on]")).toHaveCount(1);
  // The copy is styled as the page on the stage, not as the window's own headings.
  const colour = (target: typeof page, selector: string) => target.locator(selector).first().evaluate(el => getComputedStyle(el).color);
  expect(await colour(presenter, ".ct-pr-cell .ct-pv h2")).toBe(await colour(page, "[data-ct-current] h2"));
  // The copies do not repeat the ids of the document.
  expect(await presenter.locator(".ct-pv [id]").count()).toBe(0);

  // The deck moves: the window follows. (PageDown: the focus is still on the button that opened the window.)
  await page.keyboard.press("PageDown");
  await expect(position).toHaveText("一 · 2/6 · 要點 1/3");
  await expect(now.locator(".ct-pv [data-ct-step][data-ct-on]")).toHaveCount(1);

  // The window's own keys and buttons move the deck.
  await presenter.keyboard.press("ArrowRight");
  await expectAt(page, "stage 2.3.1 +0");
  await idle(page);
  await expect(position).toHaveText("一 · 3/6");
  await expect(presenter.locator(".ct-pr-notes")).toContainText("同一份內容有三種檢視");
  await expect(next.locator("h2 span")).toHaveText("下一張｜範例：一場十二分鐘的演講");
  await expect(next.locator(".ct-pv h2")).toHaveText("範例：一場十二分鐘的演講");
  await presenter.getByRole("button", { name: "上一步" }).click();
  await expectAt(page, "stage 2.2.1 +3");
  await idle(page);
  // The clock started with the first move and runs in the window too.
  await expect(presenter.locator(".ct-rmt-time")).not.toHaveText("0:00 / 12:00");

  // The mouse over the current page is the laser on the deck.
  const sheet = (await now.locator(".ct-pv").boundingBox())!;
  await presenter.mouse.move(sheet.x + sheet.width * 0.3, sheet.y + sheet.height * 0.4);
  await expectLaser(page, 0.3, 0.4);
  await presenter.mouse.move(sheet.x + sheet.width + 40, sheet.y + sheet.height + 40);
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");
  // None of this touched a relay.
  expect(remote.relay.rooms.size).toBe(0);
});

test("a presenter window opened before the remote waits, then follows", async ({ page, context }) => {
  // The room is in the link; the deck is not listening yet.
  await page.goto("/demo/index.html?view=deck&at=4.4.2");
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp")).toBeVisible();
  const room = await page.evaluate(() => window.contourDemo.remote!.room);
  await page.keyboard.press("Escape");
  await page.reload();
  // After the reload the session of this tab continues by itself; a window on its room finds it.
  const presenter = await context.newPage();
  await presenter.goto(`/demo/index.html?view=presenter&room=${room}`);
  await expect(presenter.locator(".ct-pr .ct-rmt-pos")).toHaveText("三 · 4/6 · 頁 2/2 · 要點 0/4");
  await expect(presenter.locator(".ct-pr")).not.toHaveAttribute("data-ct-wait", "");
  // A window on another room hears nothing and says it waits.
  const other = await context.newPage();
  await other.goto("/demo/index.html?view=presenter&room=7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
  await expect(other.locator(".ct-pr")).toHaveAttribute("data-ct-wait", "");
  await expect(other.locator(".ct-pr .ct-rmt-pos")).toHaveText("等待簡報視窗…");
});

test("the presenter window's keys are the deck's keys", async ({ page, context }) => {
  await page.goto("/demo/index.html?view=deck&at=4.4");
  await page.keyboard.press("r");
  const [presenter] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟講者視窗" }).click()]);
  const position = presenter.locator(".ct-pr .ct-rmt-pos");
  await expect(position).toHaveText("三 · 4/6 · 頁 1/2");
  await presenter.keyboard.press("ArrowDown");
  await expectAt(page, "stage 4.4.2 +0");
  await idle(page);
  await presenter.keyboard.press("ArrowUp");
  await expectAt(page, "stage 4.4.1 +0");
  await idle(page);
  await presenter.keyboard.press("Space");
  await expectAt(page, "stage 4.4.2 +0");
  await idle(page);
  await presenter.keyboard.press("Shift+Space");
  await expectAt(page, "stage 4.4.1 +0");
  await idle(page);
  await presenter.keyboard.press("Escape");
  await expectAt(page, "overview 4.4.1 +0");
  await expect(position).toHaveText("輪廓 · 三 · 4/6 · 頁 1/2");
  await presenter.keyboard.press("Enter");
  await expectAt(page, "stage 4.4.1 +0");
});

/* ---- tilt ---- */

/** The five aimed readings of tests/unit/remote/tilt.test.ts: a screen 14° left, 16° right, 9° up, 7° down of (358°, 10°). */
const AIMED: [string, number, number, [number, number]][] = [
  ["中央", 358, 10, [0.5, 0.5]],
  ["左上角", 12, 19, [0, 0]],
  ["右上角", 342, 19, [1, 0]],
  ["右下角", 342, 3, [1, 1]],
  ["左下角", 12, 3, [0, 1]],
];

test("tilt: guided calibration maps the phone's aim to the screen, and survives a reload", async ({ page, remote }) => {
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "傾斜" }).click();
  const hint = phone.locator(".ct-rmt-tools p");
  const hold = phone.getByRole("button", { name: "按住指向" });
  await expect(hold).toBeHidden();
  await tiltTo(phone, 100, 0);
  await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
  await expect(hold).toBeVisible();
  await expect(hint).toContainText("尚未校正");

  // Uncalibrated: the direction of the first press is the centre of a screen ±20° by ±12°.
  const press = async () => {
    await hold.hover();
    await phone.mouse.down();
  };
  await press();
  await expectLaser(page, 0.5, 0.5);
  await tiltTo(phone, 90, 6);
  await expectLaser(page, 0.75, 0.25);
  await phone.mouse.up();
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");

  // The guided calibration: the deck shows the dot on each target, the phone asks for it by name.
  await phone.getByRole("button", { name: "校正", exact: true }).click();
  for (const [index, [name, alpha, beta, [x, y]]] of AIMED.entries()) {
    await expect(hint).toHaveText(`${index + 1}/5　把手機頂端對準螢幕的${name}`);
    await expectLaser(page, x, y);
    await expect(phone.locator(".ct-rmt-dot")).toHaveAttribute("data-target", "");
    await tiltTo(phone, alpha, beta, index * 7 - 10);
    // Long enough for the six readings a sample averages.
    await phone.waitForTimeout(150);
    await phone.getByRole("button", { name: "對準了" }).click();
  }
  await expect(hint).toContainText("已校正");
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");
  const stored = await phone.evaluate(() => JSON.parse(sessionStorage.getItem("contour-deck:tilt")!) as Record<string, number>);
  expect((stored.left * 180) / Math.PI).toBeCloseTo(14, 3);
  expect((stored.right * 180) / Math.PI).toBeCloseTo(-16, 3);
  expect((stored.top * 180) / Math.PI).toBeCloseTo(9, 3);
  expect((stored.bottom * 180) / Math.PI).toBeCloseTo(-7, 3);

  // Calibrated pointing: each side on its own scale, across the alpha seam, whatever the roll of the wrist.
  await tiltTo(phone, 358, 10);
  await press();
  await expectLaser(page, 0.5, 0.5);
  await tiltTo(phone, 5, 14.5, 30);
  await expectLaser(page, 0.25, 0.25);
  await tiltTo(phone, 350, 6.5, -20);
  await expectLaser(page, 0.75, 0.75);
  // Past the right edge the dot waits at the edge.
  await tiltTo(phone, 330, 10);
  await expectLaser(page, 1, 0.5);
  await phone.mouse.up();
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");

  // Drift: aim where the centre should be and re-centre.
  await tiltTo(phone, 20, 12);
  await phone.waitForTimeout(150);
  await phone.getByRole("button", { name: "重新置中" }).click();
  await press();
  await expectLaser(page, 0.5, 0.5);
  await tiltTo(phone, 27, 12);
  await expectLaser(page, 0.25, 0.5);
  await phone.mouse.up();

  // The calibration, re-centred, is still there after a reload of the phone.
  await phone.reload();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await phone.getByRole("button", { name: "傾斜" }).click();
  await tiltTo(phone, 27, 12);
  await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
  await expect(hint).toContainText("已校正");
  await press();
  await expectLaser(page, 0.25, 0.5);
  await phone.mouse.up();
});

test("tilt: held in landscape, the long edge points and the other axes carry the aim", async ({ page, remote }) => {
  const phone = await remote.phone(await remote.start(), undefined, { width: 844, height: 390 });
  await page.getByRole("button", { name: "允許", exact: true }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  expect(await phone.evaluate(() => screen.orientation.angle)).toBe(90);
  await phone.getByRole("button", { name: "傾斜" }).click();
  await tiltTo(phone, 100, 0, 0);
  await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
  const hold = phone.getByRole("button", { name: "按住指向" });
  await hold.hover();
  await phone.mouse.down();
  await expectLaser(page, 0.5, 0.5);
  // 10° to the right is still alpha; 6° up is now a turn about the device's short axis, gamma.
  await tiltTo(phone, 90, 0, -6);
  await expectLaser(page, 0.75, 0.25);
  await phone.mouse.up();
});

test("tilt: samples that are not a screen are refused, and cancel leaves the old calibration", async ({ page, remote }) => {
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "傾斜" }).click();
  await tiltTo(phone, 100, 0);
  await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
  await phone.getByRole("button", { name: "校正", exact: true }).click();
  // The phone never moves: five identical samples.
  for (let i = 0; i < 5; i++) await phone.getByRole("button", { name: "對準了" }).click();
  await expect(phone.locator(".ct-rmt-tools p")).toHaveText("範圍太小或方向不一致，請重新校正。");
  expect(await phone.evaluate(() => sessionStorage.getItem("contour-deck:tilt"))).toBeNull();
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");

  await phone.getByRole("button", { name: "校正", exact: true }).click();
  await expectLaser(page, 0.5, 0.5);
  await phone.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");
  await expect(phone.getByRole("button", { name: "按住指向" })).toBeVisible();
});

/** iOS: `DeviceOrientationEvent.requestPermission` exists and answers once per call. */
const permission = (answer: string) => async (context: BrowserContext) => {
  await context.addInitScript(result => {
    const calls: boolean[] = [];
    Object.assign(window, { ctPermissionCalls: calls });
    Object.assign(DeviceOrientationEvent, {
      requestPermission() {
        // iOS refuses the prompt outside a user gesture.
        calls.push(navigator.userActivation.isActive);
        return Promise.resolve(result);
      },
    });
  }, answer);
};

test("tilt: the sensor permission is asked on the tap, and a refusal is said", async ({ remote }) => {
  const link = await remote.start();
  const phone = await remote.phone(link, permission("denied"));
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
  // Nothing asked for the sensor on load.
  expect(await phone.evaluate(() => (window as unknown as { ctPermissionCalls: boolean[] }).ctPermissionCalls)).toEqual([]);
});

test("tilt: with the permission granted on the tap the sensor starts; refused, it says so", async ({ page, remote }) => {
  const link = await remote.start();
  for (const answer of ["denied", "granted"]) {
    const phone = await remote.phone(link, permission(answer));
    await page.locator(".ct-rp-ask").last().getByRole("button", { name: "允許", exact: true }).click();
    await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
    await phone.getByRole("button", { name: "傾斜" }).click();
    await tiltTo(phone, 100, 0);
    await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
    if (answer === "denied") await expect(phone.locator(".ct-rmt-tools p")).toHaveText("沒有取得動作感測的權限，請到瀏覽器設定允許後再試。");
    else await expect(phone.getByRole("button", { name: "按住指向" })).toBeVisible();
    // Asked once, inside the tap.
    expect(await phone.evaluate(() => (window as unknown as { ctPermissionCalls: boolean[] }).ctPermissionCalls)).toEqual([true]);
  }
});

test("tilt: a browser without readings says the sensor is missing", async ({ remote }) => {
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "傾斜" }).click();
  await phone.getByRole("button", { name: "啟用傾斜感測" }).click();
  await expect(phone.locator(".ct-rmt-tools p")).toHaveText("這個裝置或瀏覽器沒有提供方向感測。", { timeout: 4000 });
  await expect(phone.getByRole("button", { name: "按住指向" })).toBeHidden();
});
