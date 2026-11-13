import { expect, type Page } from "@playwright/test";
import type { Deck } from "../../src/core/index.js";
import type { RemoteHost } from "../../src/remote/index.js";

declare global {
  interface Window {
    contourDemo: { deck: Deck | null; remote: RemoteHost | null; events: string[]; open(options?: object): void; close(): void };
  }
}

export const DEMO = "/demo/index.html";

/** `mode block.slide.page +steps`, for example `stage 4.4.2 +1`. */
export function where(page: Page): Promise<string> {
  return page.evaluate(() => {
    const deck = window.contourDemo.deck;
    if (!deck) return "closed";
    const s = deck.state;
    return `${s.mode} ${s.block}.${s.slide}.${s.page} +${s.step}`;
  });
}

export async function expectAt(page: Page, expected: string) {
  await expect.poll(() => where(page), { timeout: 6000 }).toBe(expected);
}

/** Resolves once no transition is running and the current slide has stopped scrolling. */
export async function idle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        let last = "";
        let same = 0;
        const tick = () => {
          const app = document.querySelector(".ct-app");
          const slide = document.querySelector("[data-ct-current]")?.parentElement;
          const busy = app?.hasAttribute("data-ct-busy");
          const now = `${slide?.scrollTop} ${slide?.parentElement?.scrollLeft}`;
          same = !busy && now === last ? same + 1 : 0;
          last = now;
          if (same >= 3) resolve();
          else setTimeout(tick, 60);
        };
        tick();
      })
  );
}

/** Scroll geometry of the slide on the stage. */
export function slideBox(page: Page) {
  return page.evaluate(() => {
    const slide = document.querySelector("[data-ct-current]")!.parentElement!;
    const pages = Array.from(slide.children).filter(el => el.hasAttribute("data-ct-page")) as HTMLElement[];
    return {
      top: Math.round(slide.scrollTop),
      viewport: slide.clientHeight,
      height: slide.scrollHeight,
      pages: pages.map(el => ({ top: el.offsetTop, height: el.offsetHeight })),
    };
  });
}

export const thumb = (page: Page, label: string) => page.locator(`.ct-thumb[aria-label^="${label}"]`);

/** Opens the demo as a deck on the outline and clicks a thumbnail, e.g. `三、翻頁怎麼運作，第 4 張`. */
export async function openFromOutline(page: Page, label: string, expected: string) {
  await page.goto(`${DEMO}?view=deck`);
  await expectAt(page, "overview 1.1.1 +0");
  await thumb(page, label).click();
  await expectAt(page, expected);
  await idle(page);
}

/**
 * One wheel gesture as a trackpad sends it: a push, then an inertia tail of shrinking deltas a frame apart.
 * The push is a real wheel event from the mouse; the tail is dispatched in the page, because under load
 * the test runner cannot keep its own events a frame apart, and a late event is, rightly, a new gesture.
 */
export async function wheelGesture(page: Page, delta: number, tail = [delta / 2, delta / 4, delta / 10]) {
  await page.mouse.move(600, 420);
  await page.mouse.wheel(0, delta);
  await page.evaluate(async deltas => {
    const target = document.elementFromPoint(600, 420)!;
    for (const deltaY of deltas) {
      await new Promise(resolve => setTimeout(resolve, 12));
      target.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
    }
  }, tail);
}

/** Largest difference, in pixels, between the boxes of two elements. */
export function boxGap(page: Page, first: string, second: string): Promise<number> {
  return page.evaluate(
    ([a, b]) => {
      const one = document.querySelector(a)!.getBoundingClientRect();
      const two = document.querySelector(b)!.getBoundingClientRect();
      return Math.max(
        Math.abs(one.left - two.left),
        Math.abs(one.top - two.top),
        Math.abs(one.width - two.width),
        Math.abs(one.height - two.height)
      );
    },
    [first, second]
  );
}

/**
 * Presses `key` in the page and watches the transition it starts: how long the deck stays busy,
 * and the configured length of every animation that ran, in milliseconds.
 */
export function watchTransition(page: Page, key: string): Promise<{ elapsed: number; animations: number[] }> {
  return page.evaluate(
    pressed =>
      new Promise<{ elapsed: number; animations: number[] }>(resolve => {
        const started = performance.now();
        const app = document.querySelector(".ct-app")!;
        const seen = new Set<number>();
        const sample = () => {
          for (const animation of app.getAnimations({ subtree: true })) {
            if (!(animation instanceof CSSTransition)) seen.add(Number(animation.effect?.getTiming().duration));
          }
          if (app.hasAttribute("data-ct-busy")) return void requestAnimationFrame(sample);
          resolve({ elapsed: performance.now() - started, animations: [...seen].sort((a, b) => a - b) });
        };
        // On the body: a synthetic key on the focused thumbnail would wait for the click only a real key press makes.
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: pressed, bubbles: true }));
        sample();
      }),
    key
  );
}

/** Presses the right arrow until every step of the current page is shown: the arrow reveals steps before it changes slides. */
export async function revealWithArrows(page: Page) {
  const hidden = await page.locator("[data-ct-current] [data-ct-step]:not([data-ct-on])").count();
  for (let i = 0; i < hidden; i++) await page.keyboard.press("ArrowRight");
}

/** Replaces the demo deck with `count` generated blocks (block b has 1 + 7b mod 9 slides of 1 to 3 pages) and opens it. */
export async function openGenerated(page: Page, count: number, options: object = {}) {
  await page.goto(DEMO);
  await page.evaluate(
    ([count, options]) => {
      const root = document.querySelector<HTMLElement>("[data-ct-deck]")!;
      const pages = (b: number, s: number) =>
        Array.from({ length: 1 + (s % 3) }, (_, p) => `<div data-ct-page><h2>${b + 1}.${s + 1}.${p + 1}</h2><p>text</p></div>`).join("");
      const slides = (b: number) => Array.from({ length: 1 + ((b * 7) % 9) }, (_, s) => `<section data-ct-slide data-title="${b + 1}.${s + 1}">${pages(b, s)}</section>`).join("");
      root.innerHTML = Array.from({ length: count }, (_, b) => `<section data-ct-block data-title="Block ${b + 1}">${slides(b)}</section>`).join("");
      window.contourDemo.open(options);
    },
    [count, options] as const
  );
}

/** The depth desk: the title of the row in front, and the 3D matrix of each row. */
export const frontRow = (page: Page) => page.locator(".ct-tile[data-ct-front] .ct-tt").textContent();
export function rowMatrix(page: Page, index: number) {
  return page.locator(".ct-tile").nth(index).evaluate(el => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { m11: m.m11, m12: m.m12, m21: m.m21, m22: m.m22, m13: m.m13, m23: m.m23, m43: m.m43 };
  });
}
