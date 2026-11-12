# contour-deck

<p align="center">
  <a href="https://wayne930242.github.io/contour-deck/">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/tour-light.gif">
      <img src="https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/tour.gif" alt="Open a slide from the outline, move left and right, scroll down its pages, and return to the outline" width="800">
    </picture>
  </a>
</p>

Outline-first slide decks on real DOM.
A deck is blocks, slides, and pages: it opens on an outline of every block, a block opens into a left-right track of slides, and each slide scrolls down one page at a time.
The core is plain TypeScript with no runtime dependency (7 KB of JavaScript and 3 KB of CSS, gzipped).

Status: M1 in progress, local only, not published, no licence yet.
The design is in [docs/DESIGN.md](docs/DESIGN.md) (Traditional Chinese); the HTML the core reads is in [docs/CONTRACT.md](docs/CONTRACT.md).

## 看看它怎麼動

[線上示範](https://wayne930242.github.io/contour-deck/)可以直接操作；[影片與截圖頁](https://wayne930242.github.io/contour-deck/media.html)有每一段的 mp4 與原尺寸截圖。
下面的動畫是真實的鍵盤與滑鼠操作（圓圈是滑鼠，黑底小標是按下的鍵），用 `pnpm media` 重錄。

| | |
| --- | --- |
| ![跨區塊移動：翻到區塊盡頭時拉遠再推進，位置列的圓點直接飛到另一個區塊](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/move.gif) | ![3D 結構：輪廓傾斜、頁疊成層，仍可點進投影片](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/structure.gif) |
| 跨區塊移動：拉遠再推進，位置列的圓點直接飛到別的區塊 | 3D 結構：按 3，頁疊成層 |
| ![步驟：表格一列一列出現，步驟用完才換頁](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/build.gif) | ![手機：講稿檢視、輪廓、舞台與往上滑的換頁](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/phone.gif) |
| 步驟：空白鍵讓表格一列一列出現 | 手機：講稿檢視與往上滑換頁 |

| | |
| --- | --- |
| ![輪廓：七個區塊的縮圖牆](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/overview.png) | ![3D 結構](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/overview-3d.png) |
| 輪廓 | 3D 結構 |
| ![舞台旁的講稿面板](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/notes.png) | ![淺色主題的舞台](https://raw.githubusercontent.com/wayne930242/contour-deck/main/docs/media/light.png) |
| 講稿面板（按 N） | 淺色主題 |

## Use

```ts
import { createDeck } from "contour-deck";
import "contour-deck/style.css";

const root = document.querySelector<HTMLElement>("[data-ct-deck]")!;
if (new URLSearchParams(location.search).has("view")) {
  const deck = createDeck(root);
  deck.on("exit", () => deck.destroy());
}
```

Without the script the deck element is a plain document.
`createDeck` moves that same element onto a stage inside a full-window shell (`.ct-app`), and `destroy()` puts it back.
[demo/index.html](demo/index.html) is a complete host page.

### Astro

```ts
// astro.config.ts: the Markdown side, see docs/PLUGINS.md
import { remarkDeck } from "contour-deck/remark";
import { rehypeDeck } from "contour-deck/rehype";

const isDeck = file => file.data.astro?.frontmatter?.type === "slide";
// remarkPlugins: [remarkDirective, [remarkDeck, { match: isDeck }], …]
// rehypePlugins: […, [rehypeDeck, { match: isDeck }]]
```

```astro
---
import Deck from "contour-deck/astro";
const { Content } = await render(post);
---

<button data-ct-start>START</button>
<a href="?view=notes" data-ct-start="notes">Notes</a>

<Deck docClass="prose" legacy>
  <Content />
</Deck>
```

`Deck` renders a wrapper around the slot, loads the stylesheet, and starts the core: on `?view=deck` or `?view=notes`, and on a click on any `[data-ct-start]` control (`data-ct-start="notes"` opens the notes view).
It closes the deck on `exit`, gives the focus back to the control that opened it, and works under Astro's client router.

| Prop | Meaning |
| --- | --- |
| `class` | Classes of the wrapper in both views. |
| `docClass` | Classes the wrapper carries only while the deck is closed. Use it for a prose class: the open deck stays inside the wrapper, and such a class would restyle the stage and the shell. |
| `paging`, `overview` | The options of the same name below. |
| `legacy` | Accept old reveal.js links: `?view=slides&slide=h.v` opens the slide that carries that `data-legacy` index. |

A page that is not Astro gets the same behaviour from `mountAll()` in `contour-deck/host`, with the wrapper written by hand (`<div data-ct-host data-ct-doc-class="prose" data-ct-legacy>`).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `paging` | `"snap"` | `"snap"`: one wheel or trackpad gesture moves one stop. `"free"`: native scrolling with proximity snap. |
| `overview` | `"flat"` | `"3d"` opens the outline as the tilted 3D structure. |
| `linear.skip` | `["appendix"]` | Block kinds the linear advance and the arrow keys never enter. |
| `view` | from the URL | `"deck"` or `"notes"` (the speaker notes as a scrolling script, for a phone). |
| `at` | from the URL | Entry position, such as `"4.4.2"` or a slide id. |
| `url` | `true` | Read and write `?view=` and `?at=`. |
| `labels` | Traditional Chinese | Interface text; pass the entries to replace. |

### API

```ts
deck.next();            // next step, down within the page, next page, next slide, next block
deck.prev();
deck.open("4.2");       // put a block on the stage
deck.go("4.4.2");       // or deck.go("slide-id")
deck.overview();        // back to the outline
deck.state;             // { mode, block, slide, page, step }; ordinals are 1-based
deck.on("change", ({ mode, at, step }) => {});
deck.on("exit", () => deck.destroy()); // Esc on the outline, or the ✕ button of the bar
deck.destroy();
```

On opening, the focus moves into the shell: to the stage, to the current thumbnail of the outline, or to the notes script.

Each page receives `ct:enter` when it becomes the current page and `ct:leave` when it stops; both bubble.

### Keys

| Key | On the stage | On the outline |
| --- | --- | --- |
| `Space`, `Enter`, `PageDown` | advance one step | open the current slide |
| `Shift+Space`, `PageUp`, `Backspace` | back one step | |
| `←` `→` | previous, next slide | move between thumbnails |
| `↑` `↓` | previous, next stop | move between thumbnails |
| `Home`, `End` | first, last slide of the block | |
| `N` | notes panel | |
| `Esc`, `O` | outline | `Esc` leaves the deck (`exit`) |
| `3` | | 3D structure |

### URL

`?view=deck&at=4.4.2` is the second page of the fourth slide of the fourth block, counted from 1.
`at` also takes the id of a slide, a page, or an element inside one.
`?view=notes` opens the notes view.
The core removes both parameters in `destroy()` and leaves the others alone.

### Theme and host styles

- Set `--ct-bg`, `--ct-fg`, `--ct-accent`, `--ct-accent-fg`, `--ct-border`, `--ct-muted`, `--ct-mono`, and `--ct-measure` on `.ct-app`.
  By default the colours follow the site's `--background`, `--foreground`, `--accent`, `--accent-foreground`, `--border`, and `--muted-foreground`.
- A page keeps its content in a centred column of `--ct-measure` through its own side padding, so margins and widths the host sets on the content stay as written.
  The type of a page follows the size of the stage and never goes below `1rem`; sizes the host writes in `em` follow it, sizes in `rem` do not.
- The open deck keeps its ancestors, so content styles that depend on them still apply.
  Document-view styles for the deck's own elements (slide cards, block headings) must stop applying when it opens: scope them to the deck's original parent with a child combinator, as `demo/demo.css` does with `.doc > [data-ct-deck] …`.
  A class that styles every descendant (a prose class) cannot be scoped that way: take it off the ancestor while the deck is open, as `Deck`'s `docClass` does.
- The shell is `position: fixed`, so no ancestor of the deck element may have a `transform`, `filter`, or `contain` that captures fixed descendants.

## Layout

```text
src/core/      the core: model, stops, gestures, navigator, outline, rail, notes, transitions, deck
src/remark/    Markdown directives (block, vertical, summary, build)
src/rehype/    builds the deck > block > slide > page HTML
src/astro/     Deck.astro and the host script it runs (also contour-deck/host)
styles/        index.css is the entry of contour-deck/style.css
demo/          a plain-HTML deck that follows the contract, and media.html (clips and stills)
docs/media/    GIF, mp4, and PNG made by scripts/media.mjs (not in the npm package)
tests/unit/    Vitest, tests/unit/**/*.test.ts
tests/browser/ Playwright, tests/browser/**/*.spec.ts, run against demo/
```

Every module under `src/` is compiled to the same path under `dist/`, so a new subpath export only needs an entry in `package.json`.
`.astro` files are copied there as they are.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies. |
| `pnpm exec playwright install chromium` | Once, for the browser tests. |
| `pnpm typecheck` | Type-check `src/`, `tests/`, and `scripts/`. |
| `pnpm build` | Compile to `dist/` and build the demo assets in `demo/assets/`. |
| `pnpm test` | Unit tests. |
| `pnpm test:browser` | Build, then run the browser tests against the demo in Chromium. |
| `CT_BROWSERS=all pnpm test:browser` | The same in Chromium, Firefox, and WebKit (`pnpm exec playwright install firefox webkit` once). |
| `pnpm size` | Minified gzip size of the core and the CSS against the budgets (12 KB, 6 KB). |
| `pnpm demo` | Build and serve the demo on `http://127.0.0.1:41731/demo/`. |
| `pnpm media` | Record the clips and stills in `docs/media/` (needs `ffmpeg` and Chromium); the Pages workflow publishes the mp4 and png files next to the demo. |

The demo also opens straight from the file system: `demo/index.html` after `pnpm build`.

## License

[MPL-2.0](LICENSE)
