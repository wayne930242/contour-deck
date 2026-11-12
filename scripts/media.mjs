// Records the clips and stills of the README and the demo site's media page: node scripts/media.mjs [name…]
// Needs `pnpm build` (demo/assets) and ffmpeg. Serves the repo, drives demo/index.html with real keyboard and mouse
// input in Chromium, and writes docs/media/<name>.{gif,mp4} and docs/media/<name>.png.
// Also copies the mp4 and png files to demo/media/ (ignored), where the media page expects them; the Pages
// workflow does the same copy. Without names it makes everything; names pick clips and stills (see `clips`, `stills`).
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const OUT = "docs/media";
const SITE_MEDIA = "demo/media";
const PORT = Number(process.env.CT_MEDIA_PORT ?? 41747);
const BASE = `http://127.0.0.1:${PORT}/demo/index.html`;
const WIDE = { width: 1440, height: 810 };
const PHONE = { width: 390, height: 844 };
const GIF_WIDTH = 960;
const GIF_BUDGET = 4 * 1024 * 1024;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** What a viewer sees of the input: a ring for the mouse, a pulse for a tap or click, a badge for a key. */
const overlay = () => {
  const keyNames = { " ": "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Enter: "Enter" };
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      .rec-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid #fff; background: rgba(227, 49, 29, .55); box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4);
        pointer-events: none; z-index: 2147483647; transition: transform .12s, background .12s; opacity: 0; }
      .rec-cursor[data-down] { transform: scale(.7); background: rgba(227, 49, 29, .95); }
      .rec-pulse { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .9);
        box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .45); pointer-events: none; z-index: 2147483647; animation: rec-pulse .5s ease-out forwards; }
      @keyframes rec-pulse { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
      .rec-key { position: fixed; left: 50%; bottom: 52px; transform: translateX(-50%); padding: .45rem .9rem; border-radius: .5rem;
        font: 700 20px/1 ui-monospace, "SF Mono", Menlo, monospace; color: #fff; background: rgba(17, 17, 17, .86);
        border: 1.5px solid rgba(255, 255, 255, .55); pointer-events: none; z-index: 2147483647; opacity: 0; transition: opacity .25s; }
      .rec-key[data-on] { opacity: 1; transition: none; }`;
    document.head.append(style);
    const cursor = Object.assign(document.createElement("div"), { className: "rec-cursor" });
    const key = Object.assign(document.createElement("div"), { className: "rec-key" });
    document.documentElement.append(cursor, key);
    const place = event => {
      if (event.pointerType !== "mouse") return;
      cursor.style.opacity = "1";
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    };
    addEventListener("pointermove", place, true);
    addEventListener(
      "pointerdown",
      event => {
        place(event);
        if (event.pointerType === "mouse") cursor.setAttribute("data-down", "");
        const pulse = Object.assign(document.createElement("div"), { className: "rec-pulse" });
        pulse.style.left = `${event.clientX}px`;
        pulse.style.top = `${event.clientY}px`;
        document.documentElement.append(pulse);
        setTimeout(() => pulse.remove(), 600);
      },
      true
    );
    addEventListener("pointerup", () => cursor.removeAttribute("data-down"), true);
    let hide = 0;
    addEventListener(
      "keydown",
      event => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        const name = keyNames[event.key] ?? event.key.toUpperCase();
        key.textContent = event.shiftKey ? `Shift + ${name}` : name;
        key.setAttribute("data-on", "");
        clearTimeout(hide);
        hide = setTimeout(() => key.removeAttribute("data-on"), 700);
      },
      true
    );
  });
};

/** Resolves once no transition runs and the current slide has stopped scrolling (see tests/browser/helpers.ts). */
const idle = page =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        let last = "";
        let same = 0;
        const tick = () => {
          const app = document.querySelector(".ct-app");
          const slide = document.querySelector("[data-ct-current]")?.parentElement;
          const now = `${slide?.scrollTop} ${slide?.parentElement?.scrollLeft}`;
          same = !app?.hasAttribute("data-ct-busy") && now === last ? same + 1 : 0;
          last = now;
          if (same >= 3) resolve();
          else setTimeout(tick, 60);
        };
        tick();
      })
  );

const state = page => page.evaluate(() => JSON.stringify(window.contourDemo.deck?.state));

/** Moves the mouse to the middle of a locator in small steps, so the viewer follows the pointer, then lets it rest. */
async function moveTo(page, locator, { steps = 28, rest = 350 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await pause(rest);
}

async function click(page, locator, options) {
  await moveTo(page, locator, options);
  await page.mouse.down();
  await pause(90);
  await page.mouse.up();
}

/** A key press, then the time a viewer needs to see what it did. */
async function press(page, key, after = 1000) {
  await page.keyboard.press(key);
  await pause(120);
  await idle(page);
  await pause(after);
}

const thumb = (page, label) => page.locator(`.ct-thumb[aria-label^="${label}"]`);
const rail = (page, go) => page.locator(`.ct-rc i[data-ct-go="${go}"]`);

/** Waits for the deck to be on screen in the mode the URL asked for. */
async function ready(page, mode) {
  await page.waitForFunction(expected => window.contourDemo?.deck?.state.mode === expected, mode);
  await idle(page);
}

// Each clip: [viewport, colour scheme, URL query, script]. The script runs after the page is ready and the
// recording is rolling, so it opens with a pause that becomes the still first frame of the clip.
const tour = async page => {
  await pause(1100);
  await click(page, thumb(page, "三、翻頁怎麼運作，第 4 張"), { rest: 500 }); // zoom out of the thumbnail
  await idle(page);
  await pause(1100);
  await press(page, "ArrowRight", 1000); // next slide
  await press(page, "ArrowLeft", 800);
  await press(page, "ArrowDown", 1100); // the next stop is the second page
  await press(page, "ArrowDown", 1100); // a tall page has one more stop, at its foot
  await press(page, "ArrowUp", 700);
  await press(page, "Escape", 1200); // back to the outline, the ring on the slide just left
};

const crossBlock = async page => {
  await pause(1100);
  await press(page, "ArrowRight", 1000); // last slide of the block
  await press(page, "ArrowRight", 900); // pulls back and dives into the next block
  await click(page, rail(page, "4,0,0"), { rest: 250 }); // the rail: a pip of 四 (from the next block, a flight)
  await idle(page);
  await pause(1000);
  await click(page, rail(page, "1,3,1"), { rest: 250 }); // and back into 一
  await idle(page);
  await pause(1200);
};

const structure = async page => {
  await pause(1200);
  await press(page, "3", 1700); // tilts the plane and stacks the pages
  await moveTo(page, thumb(page, "附錄（書面，會上不念），第 1 張"), { steps: 36, rest: 1000 });
  await moveTo(page, thumb(page, "三、翻頁怎麼運作，第 4 張"), { steps: 36, rest: 900 });
  await click(page, thumb(page, "三、翻頁怎麼運作，第 4 張"), { rest: 200 }); // a slide still opens from 3D
  await idle(page);
  await pause(1000);
  await press(page, "Escape", 1300); // and the outline comes back in 3D
  await click(page, page.getByRole("button", { name: "3D" }), { rest: 250 });
  await idle(page);
  await pause(1100);
};

const build = async page => {
  await pause(1000);
  await press(page, "Space", 1100); // one row
  await press(page, "Space", 1300); // the next row
  await press(page, "Space", 1300); // steps used up: the next page
  await press(page, "Shift+Space", 1100); // and back, one step at a time
  await press(page, "Shift+Space", 1100);
};

const phone = async page => {
  await pause(1200);
  const script = page.locator(".ct-script");
  await script.evaluate(el => el.scrollTo({ top: el.scrollTop + 1100, behavior: "smooth" })); // read down the script
  await pause(2000);
  await page.getByRole("button", { name: "輪廓" }).tap();
  await idle(page);
  await pause(1200);
  await thumb(page, "三、翻頁怎麼運作，第 4 張").tap();
  await idle(page);
  await pause(1300);
  // A real swipe up: one page of the slide.
  const client = await page.context().newCDPSession(page);
  const swipe = async () => {
    await client.send("Input.synthesizeScrollGesture", { x: 195, y: 560, yDistance: -420, speed: 900, gestureSourceType: "touch" });
    await idle(page);
    await pause(1300);
  };
  await swipe();
  await swipe();
};

/** @type {Record<string, { viewport: { width: number, height: number }, scheme: "dark" | "light", query: string, mode: string, run: (page: import("@playwright/test").Page) => Promise<void>, mobile?: boolean }>} */
const clips = {
  tour: { viewport: WIDE, scheme: "dark", query: "?view=deck", mode: "overview", run: tour },
  "tour-light": { viewport: WIDE, scheme: "light", query: "?view=deck", mode: "overview", run: tour },
  move: { viewport: WIDE, scheme: "dark", query: "?view=deck&at=2.5", mode: "stage", run: crossBlock },
  structure: { viewport: WIDE, scheme: "dark", query: "?view=deck", mode: "overview", run: structure },
  build: { viewport: WIDE, scheme: "dark", query: "?view=deck&at=2.5", mode: "stage", run: build },
  phone: { viewport: PHONE, scheme: "dark", query: "?view=notes&at=4.4.2", mode: "notes", run: phone, mobile: true },
};

/** Stills: [viewport, scheme, query, mode, what to do before the shot]. */
const stills = {
  overview: { viewport: WIDE, scheme: "dark", query: "?view=deck", mode: "overview", prepare: async () => {} },
  "overview-3d": {
    viewport: WIDE,
    scheme: "dark",
    query: "?view=deck",
    mode: "overview",
    prepare: async page => {
      await page.keyboard.press("3");
      await page.waitForFunction(() => document.querySelector(".ct-app")?.hasAttribute("data-ct-3d"));
      await pause(1500);
      await idle(page);
    },
  },
  stage: { viewport: WIDE, scheme: "dark", query: "?view=deck&at=4.3.1", mode: "stage", prepare: async () => {} },
  notes: {
    viewport: WIDE,
    scheme: "dark",
    query: "?view=deck&at=4.4.2",
    mode: "stage",
    prepare: async page => {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Space"); // the four table rows
        await pause(700);
        await idle(page);
      }
      await page.keyboard.press("n");
      await pause(900);
      await idle(page);
    },
  },
  phone: { viewport: PHONE, scheme: "dark", query: "?view=notes&at=4.4.2", mode: "notes", mobile: true, prepare: async () => {} },
  light: { viewport: WIDE, scheme: "light", query: "?view=deck&at=2.4.2", mode: "stage", prepare: async () => {} },
};

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

/** webm → mp4 (H.264, faststart, no audio) and GIF (palette, width 960, or the phone's own size). */
function encode(webm, trim, base, viewport) {
  const size = ["-ss", trim.toFixed(2), "-i", webm];
  ffmpeg([...size, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", "-an", `${base}.mp4`]);
  const width = Math.min(GIF_WIDTH, viewport.width);
  for (const [fps, colors] of [[14, 192], [13, 160], [12, 128], [10, 112], [8, 96]]) {
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
    ffmpeg([...size, "-vf", filter, "-loop", "0", `${base}.gif`]);
    if (statSync(`${base}.gif`).size <= GIF_BUDGET) return;
    console.log(`  ${base}.gif over budget at ${fps} fps, ${colors} colours`);
  }
  throw new Error(`${base}.gif stays over ${GIF_BUDGET} bytes`);
}

async function context(browser, spec, recordDir) {
  return browser.newContext({
    viewport: spec.viewport,
    colorScheme: spec.scheme,
    deviceScaleFactor: spec.mobile ? 2 : 1,
    isMobile: !!spec.mobile,
    hasTouch: !!spec.mobile,
    reducedMotion: "no-preference",
    ...(recordDir ? { recordVideo: { dir: recordDir, size: { width: spec.viewport.width * (spec.mobile ? 2 : 1), height: spec.viewport.height * (spec.mobile ? 2 : 1) } } } : {}),
  });
}

async function recordClip(browser, name, spec, tmp) {
  const recordDir = join(tmp, name);
  const context_ = await context(browser, spec, recordDir);
  await context_.addInitScript(overlay);
  const created = Date.now();
  const page = await context_.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  await page.goto(BASE + spec.query);
  await ready(page, spec.mode);
  const trim = (Date.now() - created) / 1000 + 0.2;
  await spec.run(page);
  await pause(400);
  const video = page.video();
  await context_.close();
  if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
  const webm = await video.path();
  encode(webm, trim, join(OUT, name), spec.viewport);
  console.log(`${name}: ${(statSync(join(OUT, `${name}.gif`)).size / 1024).toFixed(0)} KB gif, ${(statSync(join(OUT, `${name}.mp4`)).size / 1024).toFixed(0)} KB mp4`);
}

async function shoot(browser, name, spec) {
  const context_ = await context(browser, spec);
  const page = await context_.newPage();
  await page.goto(BASE + spec.query);
  await ready(page, spec.mode);
  await spec.prepare(page);
  await pause(600);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await context_.close();
  console.log(`${name}.png: ${(statSync(join(OUT, `${name}.png`)).size / 1024).toFixed(0)} KB`);
}

async function main() {
  if (!existsSync("demo/assets/contour-deck.js")) throw new Error("demo/assets is missing: run pnpm build first");
  const wanted = process.argv.slice(2);
  const known = new Set([...Object.keys(clips), ...Object.keys(stills)]);
  for (const name of wanted) if (!known.has(name)) throw new Error(`unknown name ${name}; known: ${[...known].join(", ")}`);
  const pick = name => wanted.length === 0 || wanted.includes(name);

  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "contour-media-"));
  const server = spawn(process.execPath, ["scripts/serve.mjs", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  const browser = await chromium.launch();
  try {
    await pause(600);
    for (const [name, spec] of Object.entries(clips)) if (pick(name)) await recordClip(browser, name, spec, tmp);
    for (const [name, spec] of Object.entries(stills)) if (pick(name)) await shoot(browser, name, spec);
  } finally {
    await browser.close();
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }

  // The site serves the mp4 and png files from demo/media/; the gif is for the README only.
  mkdirSync(SITE_MEDIA, { recursive: true });
  for (const file of readdirSync(OUT)) if (/\.(mp4|png)$/.test(file)) copyFileSync(join(OUT, file), join(SITE_MEDIA, file));
}

await main();
