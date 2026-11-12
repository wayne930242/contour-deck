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
With different structures the file fails: `remarkDeck` records on `file.data` the structure it read the file by, and `rehypeDeck` compares it with its own.

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

A directive in the wrong form (`::summary`, `:::vertical`), with an unknown attribute, or with an invalid value is an error, not an empty box.
Footnotes and MDX ESM nodes stay outside the deck element.

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
  An opening that holds nothing but a `####` kicker, notes, `::block`, `::slide`, and HTML comments is not a slide of its own: it opens the first `##` slide.
- A top-level `###` starts a further page of the current slide.
  The exception is a `###` right under the slide's `##` with no content between them: the two head the first page together.
  So `##`, `###`, text, `###`, text is a slide of two pages, not of three with a first page that holds only the title.
  Notes, `::block`, `::slide`, and HTML comments are not content for this rule or the one above; other directives, such as `:::build`, are.
- A `###` before the block's first `##` starts a page of the block's first slide.
- Only top-level headings count.
  A heading inside a list, a quote, or a container such as `:::grid` is page content, and so are `####` and deeper and a `#` after the block's first `##`.
  Run `rehypeDeck` before any plugin that wraps headings in other elements.
- Leave a blank line before a `---`.
  Text right above it (`正文` then `---` on the next line) is a setext `##` heading in Markdown, so it starts a slide instead of a block.

Directives:

- `:::summary` and `:::build` work as in the default structure, on the page they are written on.
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
