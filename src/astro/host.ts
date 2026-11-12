/**
 * What a host page does around the core, written once: open the deck when the URL or a control asks
 * for it, close it on exit, and send old reveal.js links to their new position.
 * `Deck.astro` calls this; a plain HTML host can call it too.
 *
 * | Host markup                              | Meaning                                                      |
 * | ---------------------------------------- | ------------------------------------------------------------ |
 * | `[data-ct-host]`                         | wrapper of one `[data-ct-deck]`                              |
 * | `data-ct-doc-class="prose"`              | classes the wrapper carries only while the deck is closed    |
 * | `data-ct-paging`, `data-ct-overview`     | the `paging` and `overview` options of the core              |
 * | `data-ct-legacy`                         | accept `?view=slides&slide=h.v`                              |
 * | `[data-ct-start]`, `[data-ct-start="notes"]` | a control that opens the deck or its notes view: inside a host for that deck, elsewhere for the first deck of the page |
 */
import { createDeck } from "../core/index.js";
import type { Deck, DeckOptions } from "../core/index.js";
import { legacyAt, parseLegacy, readLegacy } from "./legacy.js";

export interface Host {
  /** The open deck, or `null` while the page shows the document. */
  readonly deck: Deck | null;
  open(options?: Pick<DeckOptions, "view" | "at">): void;
  close(): void;
  /** Closes the deck and removes every listener. */
  unmount(): void;
}

const mounted = new WeakMap<HTMLElement, Host>();

function optionsOf(host: HTMLElement): DeckOptions {
  const { ctPaging, ctOverview } = host.dataset;
  return {
    ...(ctPaging === "free" || ctPaging === "snap" ? { paging: ctPaging } : {}),
    ...(ctOverview === "3d" || ctOverview === "flat" ? { overview: ctOverview } : {}),
  };
}

/**
 * Rewrites `?view=slides&slide=h.v` to `?view=deck&at=b.s.p` in place and returns nothing:
 * the core then reads its own parameters. An old link without a match opens the outline.
 */
function adoptLegacyUrl(root: HTMLElement): void {
  const url = new URL(location.href);
  if (url.searchParams.get("view") !== "slides") return;
  const old = parseLegacy(url.searchParams.get("slide") ?? "0");
  const at = old && legacyAt(readLegacy(root), old.h, old.v);
  url.searchParams.delete("slide");
  url.searchParams.set("view", "deck");
  if (at) url.searchParams.set("at", at);
  history.replaceState(history.state, "", url);
}

/** Wires one `[data-ct-host]`. Mounting the same element twice returns the first host. */
export function mount(host: HTMLElement): Host | null {
  const known = mounted.get(host);
  if (known) return known;
  const root = host.querySelector<HTMLElement>("[data-ct-deck]");
  if (!root) return null;

  const docClasses = (host.dataset.ctDocClass ?? "").split(/\s+/).filter(Boolean);
  const abort = new AbortController();
  let deck: Deck | null = null;
  let opener: HTMLElement | null = null;

  function close() {
    if (!deck) return;
    deck.destroy();
    deck = null;
    host.classList.add(...docClasses);
    opener?.focus({ preventScroll: true });
    opener = null;
  }

  function open(options: Pick<DeckOptions, "view" | "at"> = {}) {
    if (deck) return;
    // Document-view classes (a prose class, say) would restyle the shell and the stage, so they wait outside.
    host.classList.remove(...docClasses);
    try {
      deck = createDeck(root!, { ...optionsOf(host), ...options });
    } catch (error) {
      host.classList.add(...docClasses);
      throw error;
    }
    deck.on("exit", close);
  }

  // In the capture phase: a client-side router that listens on the document would otherwise
  // take a start link as a navigation before this handler sees it.
  document.addEventListener(
    "click",
    event => {
      const control = (event.target as Element).closest?.<HTMLElement>("[data-ct-start]");
      if (!control || event.defaultPrevented) return;
      // A modified click on a start link opens it in a new tab or window, as any link.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // A control inside a host opens that deck; one elsewhere opens the first deck of the page.
      if ((control.closest("[data-ct-host]") ?? document.querySelector("[data-ct-host]")) !== host) return;
      event.preventDefault();
      opener = control;
      open({ view: control.dataset.ctStart === "notes" ? "notes" : "deck" });
    },
    { capture: true, signal: abort.signal }
  );

  if ("ctLegacy" in host.dataset) adoptLegacyUrl(root);
  const view = new URLSearchParams(location.search).get("view");
  if (view === "deck" || view === "notes") open();

  const api: Host = {
    get deck() {
      return deck;
    },
    open,
    close,
    unmount() {
      close();
      abort.abort();
      mounted.delete(host);
    },
  };
  mounted.set(host, api);
  return api;
}

/** Mounts every `[data-ct-host]` in the document that is not mounted yet. */
export function mountAll(): Host[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-ct-host]"))
    .map(mount)
    .filter((host): host is Host => host !== null);
}
