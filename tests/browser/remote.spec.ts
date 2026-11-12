/** The remote: pairing, control, pointer, ink, state, and the presenter window, over the relay stub. */
import { expectAt, idle } from "./helpers.js";
import { DECK_INK, dragPad, expect, expectLaser, inked, laser, PAD_INK, rawGuest, test } from "./remote-helpers.js";

test("R opens the remote panel with a QR for the phone and one for the notes", async ({ page, remote }) => {
  const link = await remote.start();
  const room = await remote.room();
  expect(room).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(new URL(link).searchParams.get("view")).toBe("remote");
  expect(new URL(link).searchParams.get("room")).toBe(room);
  expect(new URL(link).searchParams.has("at")).toBe(false);
  await expect(page.locator(".ct-rp-img svg")).toHaveCount(2);
  await expect(page.locator(".ct-rp-url").nth(1)).toHaveAttribute("href", /[?&]view=notes$/);
  await expect(page.getByRole("button", { name: "遙控", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The host is in the room, and alone.
  expect(remote.relay.rooms.get(room)?.guests.size).toBe(0);

  // Escape closes the panel and nothing else; R opens it again on the same room.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ct-rp")).toBeHidden();
  await expectAt(page, "stage 2.2.1 +0");
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp")).toBeVisible();
  expect(await remote.room()).toBe(room);
  // The keys still move the deck while the panel shows.
  await page.keyboard.press("Space");
  await expectAt(page, "stage 2.2.1 +1");
});

test("without a relay the panel offers the notes and the presenter window only", async ({ page }) => {
  await page.goto("/demo/index.html?view=deck&at=2.2");
  await page.getByRole("button", { name: "遙控", exact: true }).click();
  await expect(page.locator(".ct-rp")).toContainText("沒有設定中繼服務");
  await expect(page.locator(".ct-rp-img svg")).toHaveCount(1);
  await expect(page.locator(".ct-rp-url")).toHaveAttribute("href", /[?&]view=notes$/);
  await expect(page.getByRole("button", { name: "開啟講者視窗" })).toBeVisible();
});

test("pairing: the phone shows the code the deck shows, and allow gives it control", async ({ page, remote }) => {
  const phone = await remote.phone(await remote.start());
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
  const code = await phone.locator(".ct-rmt-code").innerText();
  expect(code).toMatch(/^\d{4}$/);
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
  await expect(page.locator(".ct-rp-code")).toHaveText(code);
  // Before the answer the phone has no controls and was told nothing about the deck.
  await expect(phone.getByRole("button", { name: "下一步" })).toBeHidden();
  const guest = [...remote.relay.rooms.get(await remote.room())!.guests.keys()][0];
  expect(remote.relay.received(guest, "state")).toEqual([]);

  await page.getByRole("button", { name: "允許", exact: true }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await expect(page.locator(".ct-rp-ask")).toHaveCount(0);
  await expect(page.locator(".ct-rp")).toContainText("手機已配對");
  expect(remote.relay.received(guest, "grant")[0].token).toMatch(/^[A-Za-z0-9_-]{22}$/);

  // The state arrived: position, clocks from data-minutes, the notes of its own DOM, and what comes next.
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("一 · 2/6 · 要點 0/3");
  await expect(phone.locator(".ct-rmt-time")).toHaveText("0:00 / 12:00");
  await expect(phone.locator(".ct-rmt-blk")).toHaveText("區塊　一、為什麼大綱優先0:00 / 3:00");
  await expect(phone.locator(".ct-rmt-notes")).toContainText("設計原則有三條");
  await expect(phone.locator(".ct-rmt-next")).toContainText("要點");
  await expect(phone.locator(".ct-rmt-next")).toContainText("內容只存在一份");
  // Only position and timing crossed the relay: no notes, no slide text.
  const state = remote.relay.received(guest, "state")[0];
  expect(Object.keys(state).sort()).toEqual(
    ["at", "block", "blockElapsed", "blockMinutes", "elapsed", "mode", "ratio", "step", "steps", "t", "to", "total"].sort()
  );
  expect(state).toMatchObject({ mode: "stage", at: "2.2.1", step: 0, steps: 3, elapsed: 0, total: 720, block: "一、為什麼大綱優先", blockMinutes: 3 });
});

test("pairing: deny leaves the phone without control, and it can ask again", async ({ page, remote }) => {
  const phone = await remote.phone(await remote.start());
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
  const first = await phone.locator(".ct-rmt-code").innerText();
  await page.getByRole("button", { name: "拒絕" }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "denied");
  await expect(phone.locator(".ct-rmt-card")).toContainText("電腦沒有允許這支手機");
  await expect(phone.getByRole("button", { name: "下一步" })).toBeHidden();
  await expect(phone.getByRole("link", { name: "只看講稿" })).toHaveAttribute("href", /[?&]view=notes$/);
  await expect(page.locator(".ct-rp-ask")).toHaveCount(0);
  // The denied phone left the room.
  await expect.poll(async () => remote.relay.rooms.get(await remote.room())!.guests.size).toBe(0);

  await phone.getByRole("button", { name: "重新要求控制" }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
  // A fresh code for the new request (one chance in ten thousand to repeat).
  await expect(page.locator(".ct-rp-code")).toHaveText(await phone.locator(".ct-rmt-code").innerText());
  expect(first).toMatch(/^\d{4}$/);
});

test("an unpaired guest cannot control the deck", async ({ page, remote }) => {
  await remote.start();
  const room = await remote.room();
  const stranger = await page.context().newPage();
  await stranger.goto("/demo/media.html");
  // Everything a guest could say, without having been allowed: commands, pointer, ink, and frames that pose as the relay's or the host's.
  const heard = await rawGuest(stranger, room, [
    { t: "cmd", c: "next" },
    { t: "cmd", c: "slideNext" },
    { t: "cmd", c: "open", at: "4.1" },
    { t: "ptr", x: 0.5, y: 0.5, on: true },
    { t: "ink", s: 1, pts: [0.2, 0.2, 0.8, 0.8] },
    { t: "resume", token: "A".repeat(22) },
    { t: "join", id: "forged01" },
    { t: "grant", to: "forged01", token: "A".repeat(22) },
    { t: "cmd", c: "next", from: "host" },
    { t: "ping" },
  ]);
  // The relay delivered all ten to the host.
  const guest = [...remote.relay.rooms.get(room)!.guests.keys()][0];
  expect(remote.relay.forwarded.filter(frame => frame.from === guest)).toHaveLength(10);
  await idle(page);
  await expectAt(page, "stage 2.2.1 +0");
  expect((await laser(page)).on).toBe(false);
  expect(await inked(page, DECK_INK)).toBe(0);
  // One request, the stranger's own; the forged join made none. It heard the greeting and its code, nothing else.
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
  expect(heard.map(frame => (JSON.parse(frame) as { t: string }).t)).toEqual(["hello", "pair"]);

  // A phone the presenter allows does move it, by one step.
  const phone = await remote.phone((await page.locator(".ct-rp-url").first().getAttribute("href"))!);
  await expect(page.locator(".ct-rp-ask")).toHaveCount(2);
  await page.locator(".ct-rp-ask").nth(1).getByRole("button", { name: "允許", exact: true }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
});

test("a paired phone resumes after a reload without asking again", async ({ page, remote }) => {
  const phone = await remote.paired();
  await phone.reload();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("一 · 2/6 · 要點 0/3");
  // No request showed on the deck, and the phone never showed a code.
  await expect(page.locator(".ct-rp-ask")).toHaveCount(0);
  await expect(page.locator(".ct-rp")).toContainText("手機已配對");
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
});

test("revoke takes control back and the old token is dead", async ({ page, remote }) => {
  const phone = await remote.paired();
  const room = await remote.room();
  const guest = [...remote.relay.rooms.get(room)!.guests.keys()][0];
  const token = String(remote.relay.received(guest, "grant")[0].token);
  await page.getByRole("button", { name: "收回控制" }).click();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "revoked");
  await expect(phone.locator(".ct-rmt-card")).toContainText("電腦收回了控制權");
  await expect(page.locator(".ct-rp")).not.toContainText("手機已配對");

  // Replaying the token it was granted, from a new connection, gives nothing.
  const stranger = await page.context().newPage();
  await stranger.goto("/demo/media.html");
  const heard = await rawGuest(stranger, room, [{ t: "resume", token }, { t: "cmd", c: "next" }]);
  expect(heard.map(frame => (JSON.parse(frame) as { t: string }).t)).toEqual(["hello", "pair"]);
  await idle(page);
  await expectAt(page, "stage 2.2.1 +0");

  // The phone itself has to ask again, with a code.
  await phone.reload();
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
});

test("only one phone holds control: allowing a second revokes the first", async ({ page, remote }) => {
  const first = await remote.paired();
  const second = await remote.phone((await page.locator(".ct-rp-url").first().getAttribute("href"))!);
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
  await page.getByRole("button", { name: "允許", exact: true }).click();
  await expect(second.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await expect(first.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "revoked");
  await second.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  // The first phone's token went with its control.
  await first.reload();
  await expect(first.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
});

test("commands move the deck as the keyboard does", async ({ page, remote }) => {
  const phone = await remote.paired();
  const tap = (name: string) => phone.getByRole("button", { name, exact: true }).click();
  await tap("下一步");
  await expectAt(page, "stage 2.2.1 +1");
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("一 · 2/6 · 要點 1/3");
  await tap("上一步");
  await expectAt(page, "stage 2.2.1 +0");
  await tap("下一張");
  await expectAt(page, "stage 2.3.1 +0");
  await idle(page);
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("一 · 3/6");
  await expect(phone.locator(".ct-rmt-notes")).toContainText("同一份內容有三種檢視");
  await expect(phone.locator(".ct-rmt-next")).toContainText("下一張");
  await expect(phone.locator(".ct-rmt-next")).toContainText("範例：一場十二分鐘的演講");
  await tap("上一張");
  await expectAt(page, "stage 2.2.1 +3");
  await idle(page);

  // The outline: the notes give way to the block list, and a block opens from it.
  await tap("輪廓");
  await expectAt(page, "overview 2.2.1 +3");
  await expect(phone.locator(".ct-rmt-pos")).toHaveText("輪廓");
  await expect(phone.locator(".ct-rmt-list .ct-btn")).toHaveCount(7);
  await expect(phone.locator('.ct-rmt-list [aria-current="true"]')).toContainText("一、為什麼大綱優先");
  // The step button would open the slide the deck is on, and the strip says which.
  await expect(phone.locator(".ct-rmt-next")).toHaveText("接下來三個設計原則");
  await phone.locator(".ct-rmt-list .ct-btn", { hasText: "三、翻頁怎麼運作" }).click();
  await expectAt(page, "stage 4.1.1 +0");
  await expect(phone.locator(".ct-rmt-pos")).toContainText("三 · 1/6");
  await expect(phone.locator(".ct-rmt-list")).toHaveCount(0);
});

test("the pointer tab shows the laser dot where the finger is on the pad", async ({ page, remote }) => {
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "紅點" }).click();
  // The pad has the shape of the stage and shows the current page.
  const stage = (await page.locator(".ct-stage").boundingBox())!;
  const pad = (await phone.locator(".ct-rmt-pad").boundingBox())!;
  expect(pad.width / pad.height).toBeCloseTo(stage.width / stage.height, 1);
  await expect(phone.locator(".ct-rmt-pad .ct-pv h2")).toHaveText("三個設計原則");
  expect((await laser(page)).on).toBe(false);

  await dragPad(phone, [[0.25, 0.6]], true);
  await expectLaser(page, 0.25, 0.6);
  await dragPad(phone, [[0.25, 0.6], [0.8, 0.2]], true);
  await expectLaser(page, 0.8, 0.2);
  await expect(phone.locator(".ct-rmt-dot")).toHaveAttribute("data-on", "");
  // A fast sweep of 80 samples goes out at one message per 33 ms, and the last position still arrives.
  const guest = [...remote.relay.rooms.get(await remote.room())!.guests.keys()][0];
  const sent = () => remote.relay.forwarded.filter(frame => frame.from === guest && frame.message.t === "ptr").length;
  const before = sent();
  const started = Date.now();
  const pad2 = (await phone.locator(".ct-rmt-pad").boundingBox())!;
  await phone.mouse.move(pad2.x + pad2.width * 0.3, pad2.y + pad2.height * 0.7, { steps: 80 });
  const allowed = Math.ceil((Date.now() - started) / 33) + 2;
  await expectLaser(page, 0.3, 0.7);
  expect(sent() - before).toBeLessThanOrEqual(allowed);
  expect(sent() - before).toBeLessThan(80);
  // Lifting the finger lets it fade, where it was.
  await phone.mouse.up();
  await expect(page.locator(".ct-laser")).not.toHaveAttribute("data-on", "");
  await expect(page.locator(".ct-laser")).toHaveCSS("opacity", "0");
  // Past the edge of the pad the dot stops at the edge of the stage.
  await dragPad(phone, [[0.5, 0.5], [1.4, 0.5]], true);
  await expectLaser(page, 1, 0.5);
  await phone.mouse.up();
});

test("with reduced motion the laser dot jumps and does not fade", async ({ page, remote }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "紅點" }).click();
  await expect(page.locator(".ct-laser")).toHaveCSS("transition-duration", "0s");
  await dragPad(phone, [[0.1, 0.1]], true);
  await expectLaser(page, 0.1, 0.1);
  // One frame after the message the dot is on the target: no easing in between.
  const box = (await phone.locator(".ct-rmt-pad").boundingBox())!;
  await phone.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await expect.poll(async () => (await laser(page)).x).toBeGreaterThan(0.1);
  const first = await laser(page);
  expect(first.x).toBeCloseTo(0.9, 1);
  expect(first.y).toBeCloseTo(0.9, 1);
  await phone.mouse.up();
});

test("the ink tab draws on the stage and a page change clears it", async ({ page, remote }) => {
  const phone = await remote.paired();
  await phone.getByRole("button", { name: "畫筆" }).click();
  expect(await inked(page, DECK_INK)).toBe(0);
  // The canvas has a pixel for every device pixel of the stage.
  const size = await page.locator(DECK_INK).evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.clientWidth * devicePixelRatio].map(Math.round));
  expect(size[0]).toBe(size[1]);

  await dragPad(phone, [[0.2, 0.3], [0.5, 0.7], [0.8, 0.3]]);
  // On the stroke there is ink, on the deck and on the pad; away from it there is none.
  for (const canvas of [DECK_INK, PAD_INK]) {
    const where = canvas === DECK_INK ? page : phone;
    // The stroke arrives in batches: its last point first, then the rest is there too.
    await expect.poll(() => inked(where, canvas, [0.8, 0.3])).toBeGreaterThan(0);
    expect(await inked(where, canvas, [0.2, 0.3])).toBeGreaterThan(0);
    // Halfway down the first leg and halfway up the second; the corner itself is rounded off.
    expect(await inked(where, canvas, [0.35, 0.5])).toBeGreaterThan(0);
    expect(await inked(where, canvas, [0.65, 0.5])).toBeGreaterThan(0);
    expect(await inked(where, canvas, [0.5, 0.2])).toBe(0);
    expect(await inked(where, canvas, [0.1, 0.9])).toBe(0);
  }
  // Every frame of the stroke kept to 64 points, and the last one said so.
  const strokes = remote.relay.forwarded.filter(frame => frame.message.t === "ink").map(frame => frame.message);
  expect(strokes.length).toBeGreaterThan(0);
  for (const frame of strokes) expect((frame.pts as number[]).length).toBeLessThanOrEqual(128);
  expect(strokes.at(-1)!.end).toBe(true);
  expect(new Set(strokes.map(frame => frame.s)).size).toBe(1);

  // A step on the same page keeps the ink; the next page clears it, on both sides.
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  expect(await inked(page, DECK_INK)).toBeGreaterThan(0);
  await phone.getByRole("button", { name: "下一張" }).click();
  await expectAt(page, "stage 2.3.1 +0");
  await expect.poll(() => inked(page, DECK_INK)).toBe(0);
  await expect.poll(() => inked(phone, PAD_INK)).toBe(0);

  // The clear button wipes a new drawing.
  await idle(page);
  await dragPad(phone, [[0.3, 0.5], [0.7, 0.5]]);
  await expect.poll(() => inked(page, DECK_INK, [0.5, 0.5])).toBeGreaterThan(0);
  await phone.getByRole("button", { name: "清除筆跡" }).click();
  await expect.poll(() => inked(page, DECK_INK)).toBe(0);
  await expect.poll(() => inked(phone, PAD_INK)).toBe(0);
});

test("the clocks start with the first move on the stage and reach the phone", async ({ page, remote }) => {
  const phone = await remote.paired();
  await expect(phone.locator(".ct-rmt-time")).toHaveText("0:00 / 12:00");
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  // Between states the phone counts by itself.
  await expect(phone.locator(".ct-rmt-time")).toHaveText("0:01 / 12:00", { timeout: 4000 });
  await expect(phone.locator(".ct-rmt-blk b")).toHaveText(/^0:0[12] \/ 3:00$/);
  await expect(page.locator(".ct-rp-time")).toHaveText(/^0:0[1-3]$/);
  // Reset on the deck stops it everywhere until the next move.
  await page.getByRole("button", { name: "重設" }).click();
  await expect(phone.locator(".ct-rmt-time")).toHaveText("0:00 / 12:00");
  await expect(page.locator(".ct-rp-time")).toHaveText("0:00");
});

test("the state goes out again every 15 seconds", async ({ page, remote }) => {
  await page.clock.install();
  await remote.paired();
  const guest = [...remote.relay.rooms.get(await remote.room())!.guests.keys()][0];
  const before = remote.relay.received(guest, "state").length;
  await page.clock.runFor(15_500);
  await expect.poll(() => remote.relay.received(guest, "state").length).toBe(before + 1);
  await page.clock.runFor(15_000);
  await expect.poll(() => remote.relay.received(guest, "state").length).toBe(before + 2);
});

test("the room and the pairing survive a reload of the deck", async ({ page, remote }) => {
  const phone = await remote.paired();
  const room = await remote.room();
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  await page.reload();
  // The session continues by itself: same room, panel closed, and the phone is back without a new code.
  await expect.poll(() => page.evaluate(() => window.contourDemo.remote?.room ?? null)).toBe(room);
  await expect(page.locator(".ct-rp")).toBeHidden();
  await expect(phone.locator(".ct-rmt-st")).toHaveText("已連線", { timeout: 15_000 });
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
  await expect(page.getByRole("button", { name: "遙控", exact: true })).not.toHaveAttribute("data-ct-count");
  await expectAt(page, "stage 2.2.1 +0");
  await phone.getByRole("button", { name: "下一步" }).click();
  await expectAt(page, "stage 2.2.1 +1");
  // The clock kept running across the reload.
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp-time")).not.toHaveText("0:00");
});

test("ending the remote closes the room and the next one is new", async ({ page, remote }) => {
  const phone = await remote.paired();
  const room = await remote.room();
  await page.getByRole("button", { name: "結束遙控" }).click();
  await expect(page.locator(".ct-rp")).toHaveCount(0);
  await expect(page.locator(".ct-laser")).toHaveCount(0);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "revoked");
  expect(remote.relay.rooms.has(room)).toBe(false);
  expect(await page.evaluate(key => sessionStorage.getItem(key), "contour-deck:host:/demo/index.html")).toBeNull();
  await page.keyboard.press("r");
  await expect(page.locator(".ct-rp")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.contourDemo.remote?.room)).not.toBe(room);
});

test("a request waiting while the panel is closed shows as a count on the bar button", async ({ page, remote }) => {
  const link = await remote.start();
  await page.keyboard.press("Escape");
  const phone = await remote.phone(link);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
  const barButton = page.locator('[data-ct-act="remote"]');
  await expect(barButton).toHaveAttribute("data-ct-count", "1");
  await expect(barButton).toHaveAccessibleName("遙控：1 支手機等待允許");
  // Nothing opened by itself.
  await expect(page.locator(".ct-rp")).toBeHidden();
  await barButton.click();
  await expect(page.locator(".ct-rp-code")).toHaveText(await phone.locator(".ct-rmt-code").innerText());
  await page.getByRole("button", { name: "拒絕" }).click();
  await expect(barButton).not.toHaveAttribute("data-ct-count");
  await expect(barButton).toHaveAccessibleName("遙控");
});

test("the phone says so when the deck is not there, and finds it when it comes", async ({ page, remote }) => {
  const link = await remote.start();
  const room = await remote.room();
  const phone = await remote.phone(link);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing");
  // The host's connection drops: the relay closes the room (4000), then has no host (4004).
  await remote.relay.dropHost(room);
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "offline");
  await expect(phone.locator(".ct-rmt-card")).toContainText("找不到簡報");
  // Both sides retry with backoff; the host is back first or the phone tries again.
  await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "pairing", { timeout: 20_000 });
  await expect(page.locator(".ct-rp-ask")).toHaveCount(1);
});

test("a link without a usable room says so and offers the notes", async ({ remote }) => {
  const link = new URL(await remote.start());
  link.searchParams.set("room", "not-a-room");
  const phone = await remote.phone(link.href);
  await expect(phone.locator(".ct-rmt-card")).toContainText("這個連結無法遙控");
  await expect(phone.getByRole("link", { name: "只看講稿" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "重新要求控制" })).toBeHidden();
});

test("the phone remote fits a 390 by 844 screen with the main button at the thumb", async ({ remote }) => {
  const phone = await remote.paired();
  const fits = () => phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".ct-rmt")!.scrollHeight <= innerHeight);
  for (const tab of ["講稿", "紅點", "畫筆", "傾斜"]) {
    await phone.getByRole("button", { name: tab, exact: true }).click();
    expect(await fits(), tab).toBe(true);
    // The step button is the lowest control and at least 80 px high; every button is a 44 px target.
    const go = (await phone.getByRole("button", { name: "下一步" }).boundingBox())!;
    expect(go.height).toBeGreaterThanOrEqual(80);
    expect(go.y + go.height).toBeGreaterThan(844 - 24);
    expect(go.y + go.height).toBeLessThanOrEqual(844);
    const small = await phone.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".ct-rmt button"))
        .filter(button => button.offsetParent && button.offsetHeight < 44)
        .map(button => button.textContent)
    );
    expect(small, tab).toEqual([]);
  }
});
