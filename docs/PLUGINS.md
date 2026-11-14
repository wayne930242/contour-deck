# Plugins

`contour-deck/remark` and `contour-deck/rehype` turn the slide Markdown of the blog into the HTML of [CONTRACT.md](CONTRACT.md).

```ts
import { remarkDeck } from "contour-deck/remark";
import { rehypeDeck } from "contour-deck/rehype";

// remark: after remark-directive. rehype: after every plugin that changes the content.
const match = file => /* is this a Contour deck? */ true;
remarkPlugins: [remarkDirective, [remarkDeck, { match }]],
rehypePlugins: [[rehypeDeck, { title: "大綱優先的簡報", match }]],
```

`remarkDeck` replaces the blog's `remark-editorial-directives` handling of `summary`, `build`, and `vertical` for decks that use Contour; do not let both rewrite the same directive.
`remarkDeck` options: `match` (read the directives only in files it accepts, default every file) and `structure`.
`rehypeDeck` options: `title` (deck `data-title`, default the Astro frontmatter `title`), `match` (build a deck only for files it accepts, default every file), and `structure`.
`structure` is `"slides"` (the default, described below) or `"headings"` ([Headings mode](#headings-mode)), or a function of the file that returns one of them.
Give both plugins the same `match` and the same `structure`.
A file only one of them accepts is left with markers nobody reads, or with directives nobody turned into markers.
When both run on the same file (one unified pipeline), different structures make the file fail: `remarkDeck` records on `file.data` the structure it read the file by, and `rehypeDeck` compares it with its own.

## Markdown

| Markdown | Output (`structure: "slides"`, the default) | With `structure: "headings"` |
| --- | --- | --- |
| `---` at the top level | next slide | next block |
| `##` at the top level | a heading of the page | next slide |
| `###` at the top level | a heading of the page | next page of the slide |
| `::vertical` | next page of the slide, or a new slide (see Slides and pages) | an error: write `###` |
| `:::summary` … `:::` | `<aside data-ct-notes>`, moved to be a child of the page that holds it | the same |
| `:::build` … `:::` | `data-ct-step` on each list item, table body row, or other block inside; the wrapper is removed | the same |
| `::block{title="三、翻頁怎麼運作" minutes=5 kind=appendix short=三 #id}` | starts a block. `title` is required. | sets the attributes of the block it stands in. Every attribute is optional. |
| `::slide{#tradeoff}` | the slide's `id` (otherwise `s-<block>-<slide>`) | the same |
| `:en[English]` (text form only) | `<span class="en" lang="en">`, the English line of a bilingual slide: small and muted under the Chinese, keeping its inline Markdown (see Bilingual lines) | the same; a paragraph of nothing but `:en[…]` belongs to the heading above it |
| `::background{image="/img/board.jpg" dim=0.6}` | `<div data-ct-background>`, moved to be the first child of the page that holds it (see Page backgrounds) | the same |

A directive in the wrong form (`::summary`, `:::vertical`), with an unknown attribute, or with an invalid value is an error, not an empty box.
Footnotes and MDX ESM nodes stay outside the deck element.

## Page backgrounds

```md
::background{image="/img/board.jpg" dim=0.6 credit="Photo: A. B., CC BY-SA 4.0"}
::background{video="https://example.com/clip.mp4" start=12 end=40 poster="/img/clip.jpg" dim=0.5}
::background{youtube="VIDEO_ID" start=30 end=55 poster="/img/frame.jpg" dim=0.6}
```

| Attribute | Value |
| --- | --- |
| `image`, `video`, `youtube` | Exactly one: an image URL, a video file URL, or a YouTube video. `youtube` takes the 11-character id or a `watch?v=`, `youtu.be/`, `embed/`, `shorts/`, or `live/` URL, and writes the id. |
| `start`, `end` | Seconds, for `video` and `youtube`. Playback loops from `start` (default 0) to `end` (default the end of the video). |
| `poster` | For `video` and `youtube`: the still shown until playback starts, and kept when it never does (offline venue, blocked YouTube, reduced motion). Recommended for `youtube`. |
| `dim` | Opacity of the black scrim over the media, 0 to 1, default `0.5`. Use `0.8` or more under tables and long text. |
| `position` | `object-position` of the still and the video, default `center`, for example `50% 20%`. |
| `credit` | Plain text (Markdown is not read) shown small in the bottom left corner of the stage over the scrim, and under the picture in the document. For attribution such as CC BY-SA. |

One background per page; it applies to the page it is written on, wherever in the page.
A source missing or doubled, an empty value, a value out of range, `poster`/`start`/`end` on an image, an unknown attribute, or a `::background` inside `:::summary` is an error.
A `start` at or past the end of the video is found only when it plays: the video then plays whole from 0, with a console warning.

On the stage the media fills the stage behind the page's content (`object-fit: cover`), the scrim sits between them, and the page's text turns light in both themes.
On a page taller than the stage the media and the credit stay put while the page scrolls under them.
The colours:
the page sets `--ct-fg`, `--ct-muted`, `--ct-border` and the site tokens `--foreground`, `--muted-foreground`, `--border` to `--ct-media-fg`, `--ct-media-muted`, `--ct-media-border` (defaults `#f2f2ed`, `#c9c9c3`, white at 32 %).
A host whose content uses other colour tokens restyles `.ct-stage [data-ct-page]:has(> [data-ct-background])`.

A video plays muted, without controls, only while its page is the current page of the stage; the core removes it when the page stops being current, so a hidden page never plays.
The still fades out only once playback has actually started.
YouTube plays from `youtube-nocookie.com`, muted (the still stays over it for the first 3 seconds, while YouTube shows its pause bezel), without controls, related videos, keyboard, or captions (`cc_load_policy=0`, and the captions module unloaded at every start of playback), and takes no pointer; the frame is scaled past cover so the title bar and logo stay outside the stage.
The document, the presenter window, the phone remote, and the outline show the still only, and so does the stage under `prefers-reduced-motion: reduce`.

## Bilingual lines

```md
## 為什麼在電玩場次談圍棋？

:en[Why talk about Go in a video game session?]

- 古老的競技遊戲 :en[An ancient competitive game]
```

`:en[…]` writes `<span class="en" lang="en">` with its inline Markdown (emphasis, code, links, math) inside; the leaf and container forms and any attribute are errors.
The stylesheet shows it as a line of its own under the Chinese, in the document and on the stage: `0.62em` in a list item, a table cell, or beside other text, `0.8em` when it is all of its paragraph (the plugin marks that paragraph `data-ct-en`, which moves up close under a heading before it), weight 400, no inherited uppercase or letter spacing, in the muted colour (`--ct-muted`; over a `::background` the light muted colour).
A step of `:::build` reveals its Chinese and English together.
With `structure: "headings"` a paragraph of nothing but `:en[…]` is not content for the page rules: `## 標題`, its English line, then `###` still head one page, and a `####` kicker with its English line still opens the first `##` slide.

## Slides and pages

This section and [Blocks](#blocks) describe the default structure; [Headings mode](#headings-mode) replaces both.

A `---` always starts a slide. Inside a `---` group, each `::vertical` child is a further page of the current slide, unless it starts a new slide in the same block:

- the child has an `h2` that differs from the slide's own `h2` (the first `h2` of the slide's first page; none when the first child has none), or
- the child carries `::block` or `::slide`.

A child with no `h2` (only `h3`, or body text) is always a page, and so is a child that repeats the slide's `h2` (the reveal.js auto-animate habit).
`# 拆解` on a child of its own followed by `## 領攀的譬喻` therefore gives two slides: the divider, then the content.

## Blocks

1. A deck with a `::block` uses only `::block`. A `::block` written alone between two `---` or two `::vertical` applies to the next slide. Slides before the first `::block` form a block titled by the deck title.
2. Otherwise, if any slide opens with an `h4` (`####` kicker), each such slide starts a block titled by the kicker, and the kicker stays in the slide.
3. Otherwise each section divider starts a block titled by its `h1` text (`:icon` and other empty nodes drop out). A divider is a slide whose first page holds an `h1` and nothing else (notes aside), such as `# 拆解`. A slide that has an `h1` and further content, like a title slide, is not a divider.
4. A deck with none of these is one block.

In rules 1–3, slides before the first block form a block titled by the deck title, else the deck's first `h1`, else the first slide's title.
A title that starts with `附錄` gets `data-kind="appendix"` under rules 2 and 3 (under rule 1 write `kind=appendix`).
`data-short` is `short` when given, else derived from the title: `三、…` gives `三`, `附錄 A｜…` gives `A`; no label when the lead is longer than 3 characters.

## Opening and closing

```md
::block{kind=opening}

#### 2026 哲學學術會議

# 斷頭神論

---

…

---

::block{kind=closing}

#### 全文

## 銘謝聆聽
```

`kind=opening` on the first block and `kind=closing` on the last frame the talk; in headings mode write `::block{kind=opening}` anywhere in the block, such as above its `####` (the title still comes from the heading). At most one of each, the opening only first and the closing only last, with at least one other block: otherwise the build fails.
- The deck opens on the opening's first slide instead of the outline; past its last slide it goes to the outline, with the focus on the talk's first slide. ← on its first slide does nothing; Esc or O from it goes to the outline.
- Past the last slide of the talk (an appendix is skipped as before) comes the closing; ← from its first slide goes back to that slide.
- Neither is a block of the outline or the locator rail (the rail marker hides while on one), and their minutes are not planned time. The flat outline shows a slim entry to each, `開場` before the first block and `致謝` after the last (labels `opening` and `closing`, with the block's first slide title): ← on the first thumbnail and → on the last reach them, and Enter, Space, or a click opens them. The depth desk leaves them out. Unlabelled blocks are numbered from the talk's first block. Deep links (`at=1`, the last block's number) and `deck.go` reach both; the document view shows them in place.
- They have no thumbnail to zoom from: the stage lifts in out of a slight scale-down and sinks back into one, the outline rising behind it; under reduced motion they only fade.

## Headings mode

With `structure: "headings"` the outline of the deck is the outline of the Markdown: `---` starts a block, `##` a slide, `###` a page.
It is opt-in, per plugin call or per file:

```ts
// The same for both plugins. A function picks per file; when it returns nothing the file is read as "slides".
const structure = file => file.data.astro?.frontmatter?.slideOptions?.structure;
remarkPlugins: [remarkDirective, [remarkDeck, { match, structure }]],
rehypePlugins: [[rehypeDeck, { match, structure }]],
```

A value other than `"slides"` and `"headings"` is an error, so a typo in the frontmatter does not fall back to the default silently.

```md
# 輪廓優先的簡報

副標

---

#### 一、規則

## 引言

正文

## 兩種步驟

### 清單

:::build
- 甲
- 乙
:::

### 表格

…
```

This is two blocks.
The first is titled `輪廓優先的簡報` and holds the title slide.
The second is titled `一、規則` and holds two slides: `引言` with one page (the kicker stays above its `##`), and `兩種步驟` with two pages, `清單` and `表格`.

Blocks:

- A top-level `---` starts a block.
  A `---` group without content is skipped.
- A block is titled by the first `#` or `####` heading that stands before its first `##` or `###`.
  The heading stays in its slide, as a kicker does in the default structure.
- A block without such a heading takes the title of its first slide when the deck has several blocks.
  When it is the deck's only block, it is titled by the deck title, else the deck's first `h1`, else its first slide's title.
- `::block{…}` sets `title`, `short`, `minutes`, `kind`, and `id` of the block it stands in.
  Every attribute is optional, and each one given wins over what the heading would give.
  It stands anywhere at the top level of the block, at most once, and does not start a block: only `---` does.
- A block with a title of its own (from `::block` or from its heading) gets `data-short` derived from the title, and `data-kind="appendix"` when the title starts with `附錄`, unless `::block` gives `short` or `kind`.
  A `附錄…` block that is not an appendix takes any other kind, such as `kind=main`.
  A block titled by the deck title gets neither.

Slides and pages:

- A top-level `##` starts a slide.
- Content before the block's first `##` is the block's first slide: a title slide, or a divider such as `# 拆解`.
  An opening that holds nothing but a `####` kicker, notes, `::background`, `::block`, `::slide`, and HTML comments is not a slide of its own: it opens the first `##` slide.
- A top-level `###` starts a further page of the current slide.
  The exception is a `###` right under the slide's `##` with no content between them: the two head the first page together.
  So `##`, `###`, text, `###`, text is a slide of two pages, not of three with a first page that holds only the title.
  Notes, `::background`, `::block`, `::slide`, and HTML comments are not content for this rule or the one above; other directives, such as `:::build`, are.
- A `###` before the block's first `##` starts a page of the block's first slide.
- Only top-level headings count.
  A heading inside a list, a quote, or a container such as `:::grid` is page content, and so are `####` and deeper and a `#` after the block's first `##`.
  Run `rehypeDeck` before any plugin that wraps headings in other elements.
- Leave a blank line before a `---`.
  Text right above it (`正文` then `---` on the next line) is a setext `##` heading in Markdown, so it starts a slide instead of a block.

Directives:

- `:::summary`, `:::build`, and `::background` work as in the default structure, on the page they are written on.
- `::slide{#id}` names the slide it stands in: write it under the slide's heading.
  Between a slide's content and the next `##` it is an error, because it reads as either slide's.
- `::vertical` is an error that says to write `###`.
  The mode has one way to break a page, and an error can still be given a meaning later (a page without a heading) without changing any deck.

The slide's `data-title` and `id` follow [Slide attributes](#slide-attributes).
`data-legacy` and `data-legacy-v` are not written: a deck in this mode has no reveal.js links to keep.

## Slide attributes

- `data-title` of a slide is its first `h1`–`h3`, else its first heading, else the first 40 characters of its text, else `Slide <block>.<slide>`.
- `data-legacy` is the old reveal.js horizontal index `h` (0-based, counted over `---` groups with content). Several slides that came from one stack share it. Headings mode writes neither this nor `data-legacy-v`.
- `data-legacy-v` is the old vertical index `v` of the slide's first page, 0-based. Page `k` of the slide (0-based) was old `h.(v+k)`.

## Reading time, order, steps

- `data-ms` uses the blog's formula: pages 3000 ms + 100 ms per non-space character, clamped to 3000–20000 ms; steps 1500 ms + 100 ms per character, clamped to 1500–12000 ms; both rounded to 100 ms. A page's time counts neither its notes nor its steps.
- Content children of a page get `style="--i: n"` (the order of the entrance animation), as in the blog.
