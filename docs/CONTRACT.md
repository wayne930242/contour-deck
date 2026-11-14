# HTML contract

This is the HTML that `contour-deck/rehype` (or any other producer) writes and that the core reads.
The core recognises `data-ct-*` attributes only, never tag or class names, so page content may hold any HTML, including its own `<section>` elements.
A change to this file goes in its own commit whose message starts with `contract:`.

## Example

```html
<div data-ct-deck data-title="大綱優先的簡報">
  <section data-ct-block data-title="三、翻頁怎麼運作" data-short="三" data-minutes="5">
    <section data-ct-slide id="s-4-6" data-title="長頁怎麼停靠？" data-legacy="11" data-legacy-v="0">
      <section data-ct-page data-ms="9800">
        <h2>長頁怎麼停靠？</h2>
        <ul>
          <li data-ct-step data-ms="2300">…</li>
          <li data-ct-step data-ms="1900">…</li>
        </ul>
        <aside data-ct-notes><p>…講稿…</p></aside>
      </section>
      <section data-ct-page>…</section>
    </section>
  </section>
  <section data-ct-block data-kind="appendix" data-title="附錄 A｜結構與命名" data-short="A">
    …
  </section>
</div>
```

## Nesting

```text
[data-ct-deck]          exactly one per deck
  [data-ct-block]       1 or more, element children of the deck
    [data-ct-slide]     1 or more, element children of a block
      [data-ct-page]    1 or more, element children of a slide
        content         any HTML
        [data-ct-step]  0 or more, anywhere inside the page content
        [data-ct-notes] 0 or more, element children of the page
        [data-ct-background] 0 or 1, the first element child of the page
```

- Each level holds only the level below it: a deck has no element child other than blocks, a block none other than slides, a slide none other than pages.
  Anything that belongs to the document but not to a slide (footnotes, ESM nodes) stays outside the deck element.
- A deck, block, slide, or page never appears inside page content, and decks do not nest.
- A deck without block markers still has one block that wraps every slide.
- Source order is presentation order at every level.
- Tag names are free. `section` is recommended for block, slide, and page, and `aside` for notes, so the page reads as a document without JavaScript.

## Attributes the producer writes

| Element | Attribute | Required | Value |
| --- | --- | --- | --- |
| deck | `data-ct-deck` | yes | no value |
| deck | `data-title` | no | Deck title as plain text, shown in the bar over the outline. Default: `document.title`. |
| block | `data-ct-block` | yes | no value |
| block | `data-title` | yes | Block title as plain text, for example `三、翻頁怎麼運作`. A deck with one unnamed block uses the deck title. |
| block | `data-short` | no | Label of at most 3 characters for the locator rail and thumbnail numbers, for example `三`. Default: the block's 1-based ordinal. |
| block | `data-minutes` | no | Planned minutes, a positive number (`5`, `1.5`). Omit when unknown. |
| block | `data-kind` | no | One token. The core knows `appendix`, `opening` (first block only) and `closing` (last block only); any other value is carried but has no behaviour. |
| slide | `data-ct-slide` | yes | no value |
| slide | `data-title` | yes | Slide title as plain text: its first heading, or a fallback the producer chooses. |
| slide | `id` | yes | Unique in the document. The author's id when given, otherwise `s-<b>-<s>` with the 1-based block and slide ordinals. |
| slide | `data-legacy` | no | The slide's old reveal.js horizontal index: the 0-based `h` of `?view=slides&slide=h.v`. Several slides split from one old vertical stack share it. |
| slide | `data-legacy-v` | no | The old 0-based `v` of the slide's first page; page `k` (0-based) of the slide was old `h.(v+k)`. Absent means `0`. |
| page | `data-ct-page` | yes | no value |
| page | `data-ms` | no | Reading time of the page without its steps, in whole milliseconds (autoplay). |
| step | `data-ct-step` | yes | no value |
| step | `data-ms` | no | Reading time of the step, in whole milliseconds (autoplay). |
| notes | `data-ct-notes` | yes | no value |
| background | `data-ct-background` | yes | no value |
| background | `data-video` | no | URL of a video file the core plays over the still on the stage. |
| background | `data-youtube` | no | 11-character YouTube id the core embeds over the still on the stage. At most one of `data-video` and `data-youtube`. |
| background | `data-start`, `data-end` | no | Seconds: the video loops from `data-start` (default 0) to `data-end` (default its end). |
| background | `style` | no | `--ct-dim` (scrim opacity, 0 to 1, default 0.5) and `--ct-position` (object-position, default `center`). |
| content | `data-ct-sk` | no | Thumbnail hint on an element child of a page: `text`, `list`, `table`, `grid`, `flow`, `nums`, `quote`, or `figure`. See [Thumbnails](#thumbnails). |

`data-title`, `data-short`, `data-minutes`, `data-kind`, `data-legacy`, `data-legacy-v`, and `data-ms` have meaning only on the elements listed here.

### Blocks

- `::block{title="…" minutes=5 kind=appendix}` starts a block and supplies `data-title`, `data-minutes`, and `data-kind`.
- Without `::block`, a slide that opens with a kicker heading (`####`) starts a block whose title is the heading text.
- With neither, the whole deck is one block.
- `data-kind="appendix"` marks a block the linear advance never enters: it is reached from the outline, the locator rail, or a deep link.
- `data-kind="opening"` on the first block: the deck opens on it, and past its last slide comes the outline. `data-kind="closing"` on the last block: the linear advance enters it past the talk's last slide. Neither is in the outline, the rail, or planned time; unlabelled blocks are numbered from the first block after an opening.

### Steps

- Every child a `:::build` reveals one at a time carries `data-ct-step`: list items, table body rows, or other blocks, by the rule `rehype-slides.ts` uses for fragments.
- The reveal order is document order within the page.
- A step is never inside `[data-ct-notes]`.
- Without JavaScript every step is visible.

### Notes

- `:::summary` becomes `<aside data-ct-notes>` in the page where it was written.
- A page with several notes elements reads them in document order.
- The stylesheet hides notes in the document and on the stage; the notes panel and the notes view show their HTML.

### Backgrounds

- `::background` becomes `<div data-ct-background>` as the first element child of the page where it was written; a page has at most one.
- Its children are the still, an `<img>` (the image, or the poster of a video), and optionally `<small data-ct-credit>` with plain-text attribution. A video without a poster has no `<img>`.
- The document shows the still as a picture at the top of the page and the credit under it.
- On the stage the background fills the page behind the content under a black scrim, and the page's text turns light.
  The core adds the video (`<video class="ct-bgm">`) or the YouTube frame (`<iframe class="ct-bgm">`) only while the page is the current page, removes it when the page stops being current, and adds nothing under `prefers-reduced-motion: reduce`.
- Thumbnails, the presenter window, and the phone remote show the still only.

### Thumbnails

The outline draws a schematic of each slide's first page from the first two content elements (element children of the page that are not notes, not the background, and not `h1`–`h6`).
The type of each comes from `data-ct-sk` when present, otherwise from the element itself:

| Type | Detected without a hint |
| --- | --- |
| `list` | `ul`, `ol` |
| `table` | `table`, or an element whose only element child is a `table` |
| `quote` | `blockquote` |
| `figure` | `figure`, `img`, `picture`, `svg`, `canvas`, `video`, `iframe` |
| `grid` | a `div` with two or more element children |
| `text` | anything else |

`flow` and `nums` are drawn only from a hint.

## What the core adds at run time

The producer never writes these.
The core removes all of them in `destroy()`.

| Name | On | Meaning |
| --- | --- | --- |
| `data-ct-on` | step | The step is revealed. |
| `data-ct-active` | block | The block is the one on the stage. |
| `data-ct-playing` | `.ct-bgm` | The background video has started playing; the stylesheet fades the still out. |
| `data-ct-current` | page | The page is the current one on the stage. It replaces reveal.js `.present` as the hook for entrance animations (`--i`). |
| `data-ct-open` | `<html>` | A deck is open. The stylesheet uses it to stop the document behind from scrolling. |
| `class="ct-…"` | elements the core creates | The app shell around the deck. The core adds no class to contract elements. |

Every other `data-ct-*` name is reserved for later versions, except the [host attributes](#host-attributes).

`contour-deck/remote`, when it loads, adds one `<style data-ct-remote>` at the start of `<head>` and leaves it there; its elements (`.ct-rp`, `.ct-laser`, `.ct-ink`, and the `.ct-app` of the phone and presenter views) go with the session or the view that made them.

The core moves the deck element into its shell (`.ct-app .ct-stage`) while the deck is open and puts it back in `destroy()`; it does not clone it.
The shell is inserted where the deck element was, so the deck keeps its ancestors and the styles it inherits from them.

### Events on page elements

| Event | When | `detail` |
| --- | --- | --- |
| `ct:enter` | The page becomes the current page on the stage. | `{ block, slide, page }`, 1-based |
| `ct:leave` | The page stops being current: another page, the outline, or `destroy()`. | same |

Both bubble, so a listener on the deck or the document sees them.

## Host attributes

`contour-deck/host` (the script `Deck.astro` runs) reads these from the host page.
The core does not read them, and a host that calls `createDeck` itself needs none.

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-ct-host` | the wrapper of one deck element | The element the host script mounts. The deck may sit at any depth inside it. |
| `data-ct-doc-class` | the wrapper | Space-separated classes the wrapper carries only while the deck is closed; the script removes them on opening and restores them on closing. |
| `data-ct-paging` | the wrapper | `snap` or `free`: the `paging` option of the core. |
| `data-ct-overview` | the wrapper | `flat` or `3d`: the `overview` option of the core. `3d` opens the outline as the depth desk, one row per block. |
| `data-ct-legacy` | the wrapper | Accept old reveal.js links: `?view=slides&slide=h.v` is rewritten to `?view=deck&at=…` through `data-legacy` and `data-legacy-v`. |
| `data-ct-start` | any control in the page | A click opens the deck; with the value `notes`, its notes view. Inside a wrapper it opens that deck, elsewhere the first deck of the page. |
| `data-ct-remote` | the wrapper | The deck has the remote button and the `R` key (`contour-deck/remote`, loaded on first use). |
| `data-ct-relay` | the wrapper | Base URL of the relay (`wss://…`) for the phone remote; implies `data-ct-remote`. See [PROTOCOL.md](PROTOCOL.md). |

## Deep links

The core owns two query parameters while a deck is open, and removes both in `destroy()`.

| Parameter | Value | Meaning |
| --- | --- | --- |
| `view` | `deck` | The deck is open. The host decides from this parameter whether to call `createDeck`. |
| `view` | `notes` | The deck is open in the notes view (speaker notes as a scrolling script). |
| `at` | `b.s` or `b.s.p` | 1-based ordinals: block in the deck, slide in the block, page in the slide. `4.4.2` is the second page of the fourth slide of the fourth block. |
| `at` | an element id | The slide, page, or block with that id, or the one that contains the element with that id. |

`contour-deck/remote` owns two more values of `view`, on pages that are views of a deck open elsewhere; the host loads the module when it sees them.

| Parameter | Value | Meaning |
| --- | --- | --- |
| `view` | `remote` | The phone remote of the first deck of the page. |
| `view` | `presenter` | The presenter window, in the same browser as the deck. |
| `room` | 26 characters of Crockford base32 | The room both sides meet in: the relay room of the phone, the `BroadcastChannel` of the presenter window. |

The links to these views keep every other query parameter of the deck's page and drop `at` and the fragment.

Without `at` the deck opens on the outline.
The position is in the query string, not the fragment, because a restricted page on the blog drops the fragment on redirect.
The slide `id` also works as a plain document anchor (`#s-4-6`) when the deck is closed.
