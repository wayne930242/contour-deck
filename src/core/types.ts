/** Which layer is in front: the outline, one block on the stage, or the notes script. */
export type Mode = "overview" | "stage" | "notes";

/** Where the deck is. `block`, `slide`, and `page` are 1-based ordinals, as in `?at=4.4.2`. */
export interface DeckState {
  mode: Mode;
  block: number;
  slide: number;
  page: number;
  /** Steps revealed on the current page, from 0. */
  step: number;
}

export interface DeckChange extends DeckState {
  /** The position as written in the URL, for example `4.4.2`. */
  at: string;
}

/** Interface text. The defaults are Traditional Chinese. */
export interface Labels {
  overview: string;
  notes: string;
  script: string;
  threeD: string;
  prev: string;
  next: string;
  exit: string;
  remote: string;
  here: string;
  appendix: string;
  /** The outline's entries to the opening and the closing blocks. */
  opening: string;
  closing: string;
  rail: string;
  noNotes: string;
  slides(count: number): string;
  pages(count: number): string;
  minutes(count: number): string;
  page(index: number, count: number): string;
  steps(shown: number, count: number): string;
  thumb(block: string, slide: number, title: string, pages: number): string;
}

export interface DeckOptions {
  /** `snap` moves one stop per wheel gesture; `free` leaves scrolling native with proximity snap. Default `snap`. */
  paging?: "snap" | "free";
  /** How the outline looks on entry. Default `flat`. */
  overview?: "flat" | "3d";
  /** Block kinds the linear advance and the arrow keys never enter. Default `["appendix"]`. */
  linear?: { skip?: string[] };
  /** Entry view. Default: `?view=notes` selects `notes`, anything else `deck`. */
  view?: "deck" | "notes";
  /** Entry position, in the `?at=` format. Default: the `at` query parameter. */
  at?: string;
  /** Read and write `?view=` and `?at=`. Default `true`. */
  url?: boolean;
  labels?: Partial<Labels>;
  /**
   * The remote: with this option the bar has a remote button, and the button and the `R` key call it.
   * It usually loads `contour-deck/remote` on first use. Without it the deck has neither.
   */
  remote?: (deck: Deck) => void;
}

export interface Deck {
  /** Back to the outline. */
  overview(): Promise<void>;
  /** Put a block on the stage: `"4"` or `"4.2"`. */
  open(at: string): Promise<void>;
  /** Linear advance: next step, down within the page, next page, next slide, next block. */
  next(): void;
  /** The linear advance in reverse. */
  prev(): void;
  /** Go to a position (`"4.4.2"` or an element id), with the transition that fits the distance. */
  go(at: string): Promise<void>;
  /** The slide before or after, as the left and right arrow keys: it leaves the block at its ends. */
  slideBy(direction: 1 | -1): void;
  /** One stop up or down inside the slide, as the up and down arrow keys. */
  pageBy(direction: 1 | -1): void;
  on(type: "change", listener: (change: DeckChange) => void): () => void;
  /** `exit` fires when the reader leaves: Esc on the outline, or the close button of the bar. The host usually calls `destroy()`. */
  on(type: "exit", listener: () => void): () => void;
  /** `destroy` fires once, at the start of `destroy()`, while the shell is still in the document. */
  on(type: "destroy", listener: () => void): () => void;
  readonly state: DeckState;
  /** Puts the deck element back where it was and removes everything the core added. */
  destroy(): void;
}
