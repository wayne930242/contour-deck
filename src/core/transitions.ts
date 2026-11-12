/** Zoom between a thumbnail and the stage (FLIP), with the outline pulling back around the same thumbnail. */

const EASE_OUT = "cubic-bezier(.22,1,.36,1)";
const EASE_IN_OUT = "cubic-bezier(.6,0,.35,1)";
const FADE_MS = 140;

type Direction = "in" | "out";

const fade = (el: HTMLElement, direction: Direction) =>
  el.animate(direction === "in" ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "both" });

/** The stage grows out of the rectangle `thumb` (`in`) or shrinks into it (`out`); `content` fades with it. */
export function zoomStage(stage: HTMLElement, content: HTMLElement, thumb: DOMRect, direction: Direction, ms: number, reduced: boolean): Animation[] {
  if (reduced) return [fade(stage, direction)];
  const full = stage.getBoundingClientRect();
  const small = {
    transform: `translate(${thumb.left - full.left}px,${thumb.top - full.top}px) scale(${thumb.width / full.width},${thumb.height / full.height})`,
    opacity: 0,
  };
  const big = { transform: "none", opacity: 1 };
  const isIn = direction === "in";
  return [
    stage.animate(isIn ? [small, { opacity: 1, offset: 0.3 }, big] : [big, { opacity: 1, offset: 0.7 }, small], {
      duration: ms,
      easing: isIn ? EASE_OUT : EASE_IN_OUT,
      fill: "both",
    }),
    content.animate(
      isIn ? [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: 0.6 }, { opacity: 0 }],
      { duration: ms, fill: "both" }
    ),
  ];
}

/** The outline scales up and fades around `thumb` as the stage opens (`out`), and settles back as it closes (`in`). */
export function zoomOverview(overview: HTMLElement, thumb: DOMRect, direction: Direction, ms: number, reduced: boolean): Animation {
  if (reduced) return fade(overview, direction);
  const box = overview.getBoundingClientRect();
  overview.style.transformOrigin = `${thumb.left + thumb.width / 2 - box.left}px ${thumb.top + thumb.height / 2 - box.top}px`;
  const far = { transform: "scale(1.45)", opacity: 0 };
  const near = { transform: "none", opacity: 1 };
  return overview.animate(direction === "in" ? [far, near] : [near, far], { duration: ms, easing: EASE_OUT, fill: "both" });
}

/** Resolves when every animation has finished; a cancelled one counts as finished. */
export const finished = (animations: Animation[]) => Promise.all(animations.map(animation => animation.finished.catch(() => {})));
