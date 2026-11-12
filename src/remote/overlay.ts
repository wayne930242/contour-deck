/** What a remote draws over the stage: the laser dot and the ink canvas. */
import { h } from "../core/dom.js";
import { createInk } from "./ink.js";

export interface Overlay {
  /** Shows the dot at a point of the stage ([0, 1], origin top left), or lets it fade. */
  point(x: number, y: number, on: boolean): void;
  /** Lets the dot fade where it is. */
  hide(): void;
  /** Adds points to a stroke; `key` names the stroke across messages. */
  ink(key: string, points: number[]): void;
  clear(): void;
  destroy(): void;
}

/** The dot covers this share of the remaining distance in 16 ms: quick, without the jitter of a hand. */
const EASE = 0.35;

export function createOverlay(stage: HTMLElement): Overlay {
  const canvas = h("canvas", "ct-ink", "", { "aria-hidden": "true" });
  const dot = h("div", "ct-laser", "", { "aria-hidden": "true" });
  stage.append(canvas, dot);
  const ink = createInk(canvas);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new ResizeObserver(() => {
    ink.resize();
    place();
  });
  observer.observe(stage);

  let target = { x: 0.5, y: 0.5 };
  let shown = { ...target };
  let on = false;
  let frame = 0;
  let last = 0;

  function place() {
    dot.style.transform = `translate(${shown.x * stage.clientWidth}px,${shown.y * stage.clientHeight}px)`;
  }

  // One step per animation frame, however many `ptr` messages came in since the last one.
  function step(now: number) {
    frame = 0;
    const share = motion.matches ? 1 : 1 - (1 - EASE) ** Math.max(1, (now - last) / 16);
    last = now;
    shown = { x: shown.x + (target.x - shown.x) * share, y: shown.y + (target.y - shown.y) * share };
    if (Math.abs(target.x - shown.x) + Math.abs(target.y - shown.y) < 0.0005) shown = { ...target };
    else frame = requestAnimationFrame(step);
    place();
  }

  return {
    point(x, y, show) {
      target = { x, y };
      // Coming on, the dot appears where it is aimed; it does not sweep in from where it was last seen.
      if (show && !on) shown = { x, y };
      on = show;
      dot.toggleAttribute("data-on", show);
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
    hide() {
      on = false;
      dot.removeAttribute("data-on");
    },
    ink: (key, points) => ink.add(key, points),
    clear: () => ink.clear(),
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.remove();
      dot.remove();
    },
  };
}
