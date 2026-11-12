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
`remarkDeck` option: `match` (read the directives only in files it accepts, default every file).
`rehypeDeck` options: `title` (deck `data-title`, default the Astro frontmatter `title`) and `match` (build a deck only for files it accepts, default every file).
Give both plugins the same `match`: a file only one of them accepts is left with markers nobody reads, or with directives nobody turned into markers.

## Markdown

| Markdown | Output |
| --- | --- |
| `---` at the top level | next slide |
| `::vertical` | next page of the slide, or a new slide (see Slides and pages) |
| `:::summary` … `:::` | `<aside data-ct-notes>`, moved to be a child of the page that holds it |
| `:::build` … `:::` | `data-ct-step` on each list item, table body row, or other block inside; the wrapper is removed |
| `::block{title="三、翻頁怎麼運作" minutes=5 kind=appendix short=三 #id}` | starts a block. `title` is required. |
| `::slide{#tradeoff}` | the slide's `id` (otherwise `s-<block>-<slide>`) |

A directive in the wrong form (`::summary`, `:::vertical`), with an unknown attribute, or with an invalid value is an error, not an empty box.
Footnotes and MDX ESM nodes stay outside the deck element.

## Slides and pages

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

## Slide attributes

- `data-title` of a slide is its first `h1`–`h3`, else its first heading, else the first 40 characters of its text, else `Slide <block>.<slide>`.
- `data-legacy` is the old reveal.js horizontal index `h` (0-based, counted over `---` groups with content). Several slides that came from one stack share it.
- `data-legacy-v` is the old vertical index `v` of the slide's first page, 0-based. Page `k` of the slide (0-based) was old `h.(v+k)`.

## Reading time, order, steps

- `data-ms` uses the blog's formula: pages 3000 ms + 100 ms per non-space character, clamped to 3000–20000 ms; steps 1500 ms + 100 ms per character, clamped to 1500–12000 ms; both rounded to 100 ms. A page's time counts neither its notes nor its steps.
- Content children of a page get `style="--i: n"` (the order of the entrance animation), as in the blog.
