/** Browser tests of the remote: a deck page (the host) and phone pages, joined by the relay stub. */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test as base } from "./fixtures.js";
import { DEMO } from "./helpers.js";
import { RELAY, RelayStub } from "./relay-stub.js";

export { RELAY };

export interface Remote {
  relay: RelayStub;
  /** The room of the host page's session. */
  room(): Promise<string>;
  /** Opens the demo deck at `at` with the stub as its relay, opens the remote panel, and returns the phone link. */
  start(at?: string): Promise<string>;
  /** A phone: a context of its own (own storage) with touch, 390×844 unless `size` says otherwise, on the given link. */
  phone(link: string, init?: (context: BrowserContext) => Promise<void>, size?: { width: number; height: number }): Promise<Page>;
  /** `start`, a phone, and the presenter's "allow": a phone in control. */
  paired(at?: string): Promise<Page>;
}

export const test = base.extend<{ remote: Remote }>({
  remote: async ({ page, context, browser, pageErrors }, use) => {
    const relay = new RelayStub();
    await relay.install(context);
    const contexts: BrowserContext[] = [];
    const watch = (other: Page) => {
      other.on("pageerror", error => pageErrors.push(error.message));
      other.on("console", message => {
        if (message.type() === "error") pageErrors.push(message.text());
      });
    };
    context.on("page", watch);
    const remote: Remote = {
      relay,
      room: () => page.evaluate(() => window.contourDemo.remote!.room),
      async start(at = "2.2") {
        await page.goto(`${DEMO}?view=deck&at=${at}&relay=${encodeURIComponent(RELAY)}`);
        await page.keyboard.press("r");
        await expect(page.locator(".ct-rp")).toBeVisible();
        await expect(page.locator(".ct-rp .ct-badge").first()).toHaveText("中繼已連線");
        return (await page.locator(".ct-rp-url").first().getAttribute("href"))!;
      },
      async phone(link, init, size = { width: 390, height: 844 }) {
        // The screen is given too: without it the emulated phone reports a landscape screen behind a portrait viewport.
        const own = await browser.newContext({ viewport: size, screen: size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        contexts.push(own);
        await relay.install(own);
        await init?.(own);
        const phone = await own.newPage();
        watch(phone);
        await phone.goto(link);
        return phone;
      },
      async paired(at) {
        const phone = await remote.phone(await remote.start(at));
        await page.getByRole("button", { name: "允許", exact: true }).click();
        await expect(phone.locator(".ct-rmt")).toHaveAttribute("data-ct-phase", "granted");
        await expect(phone.locator(".ct-rmt-st")).toHaveText("已連線");
        return phone;
      },
    };
    await use(remote);
    for (const own of contexts) await own.close();
  },
});

export { expect };

/** The laser dot of the deck: whether it shows, and where, as a share of the stage. */
export function laser(page: Page): Promise<{ on: boolean; x: number; y: number }> {
  return page.evaluate(() => {
    const dot = document.querySelector(".ct-stage > .ct-laser")!;
    const stage = document.querySelector<HTMLElement>(".ct-stage")!;
    const box = stage.getBoundingClientRect();
    const at = dot.getBoundingClientRect();
    return {
      on: dot.hasAttribute("data-on"),
      x: Math.round(((at.left - box.left - stage.clientLeft) / stage.clientWidth) * 1000) / 1000,
      y: Math.round(((at.top - box.top - stage.clientTop) / stage.clientHeight) * 1000) / 1000,
    };
  });
}

export async function expectLaser(page: Page, x: number, y: number) {
  await expect
    .poll(async () => {
      const dot = await laser(page);
      return dot.on && Math.abs(dot.x - x) < 0.012 && Math.abs(dot.y - y) < 0.012 ? "there" : JSON.stringify(dot);
    })
    .toBe("there");
}

/** Inked pixels of a canvas: in all, or in the 9×9 device pixels around a point of it. */
export function inked(page: Page, selector: string, at?: [number, number]): Promise<number> {
  return page.evaluate(
    ([target, point]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(target as string)!;
      const context = canvas.getContext("2d")!;
      const [x, y] = point ? [Math.round((point as number[])[0] * canvas.width) - 4, Math.round((point as number[])[1] * canvas.height) - 4] : [0, 0];
      const { data } = point ? context.getImageData(x, y, 9, 9) : context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
      return count;
    },
    [selector, at ?? null] as const
  );
}

export const DECK_INK = ".ct-stage > .ct-ink";
export const PAD_INK = ".ct-rmt-pad > .ct-ink";

/** A drag over the phone's pad through points given as shares of the pad; the mouse stays down when `hold` is set. */
export async function dragPad(phone: Page, points: [number, number][], hold = false) {
  const box = (await phone.locator(".ct-rmt-pad").boundingBox())!;
  const to = ([x, y]: [number, number]) => phone.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 });
  await to(points[0]);
  await phone.mouse.down();
  for (const point of points.slice(1)) await to(point);
  if (!hold) await phone.mouse.up();
}

/**
 * The phone's orientation sensor, as a stream: the page reports the given reading 60 times a second
 * until the next call, as a real sensor does.
 */
export function tiltTo(phone: Page, alpha: number, beta: number, gamma = 0) {
  return phone.evaluate(
    reading => {
      const state = window as unknown as { ctTilt?: { reading: object; timer: number } };
      const fire = () => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", state.ctTilt!.reading));
      if (state.ctTilt) state.ctTilt.reading = reading;
      else state.ctTilt = { reading, timer: window.setInterval(fire, 16) };
    },
    { alpha, beta, gamma }
  );
}

/** A guest that speaks the wire protocol by hand, from a page: what a stranger with the link can do. */
export async function rawGuest(page: Page, room: string, frames: object[]): Promise<string[]> {
  return page.evaluate(
    ([url, list]) =>
      new Promise<string[]>(resolve => {
        const heard: string[] = [];
        const socket = new WebSocket(url as string);
        socket.onmessage = event => {
          heard.push(String(event.data));
          const message = JSON.parse(String(event.data)) as { t: string };
          // Once the host has answered the join with a code, say everything and stay connected a moment.
          if (message.t !== "pair") return;
          for (const frame of list as object[]) socket.send(JSON.stringify(frame));
          setTimeout(() => resolve(heard), 400);
        };
        socket.onclose = () => resolve(heard);
      }),
    [`${RELAY}/v1/room/${room}?role=guest`, frames] as const
  );
}
