/**
 * Styles of the remote, injected with the module so a page pays for them only when the remote loads.
 * They build on contour-deck/style.css (`.ct-app`, `.ct-btn`, `.ct-badge`, `.ct-meta`, the `--ct-*` variables)
 * and go first in <head>, so a host's own rules win a tie.
 */
const css = `
.ct-btn[data-ct-act="remote"]:is([data-ct-count], [data-ct-taken])::after { content: attr(data-ct-count); content: attr(data-ct-count) / ""; margin-left: .4em; padding: .1em .4em; background: var(--ct-accent); color: var(--ct-accent-fg); }
.ct-btn[data-ct-act="remote"][data-ct-taken]::after { content: "!"; content: "!" / ""; }

/* ---- over the stage: laser dot and ink ---- */
.ct-ink { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; color: var(--ct-accent); }
.ct-laser { position: absolute; left: 0; top: 0; z-index: 6; width: 0; height: 0; pointer-events: none; opacity: 0; transition: opacity .28s; }
.ct-laser::after { content: ""; position: absolute; width: clamp(12px, 1.6cqw, 28px); aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; background: #ff2d1a; box-shadow: 0 0 0 2px rgb(255 255 255 / .85), 0 0 14px 5px rgb(255 45 26 / .55); }
.ct-laser[data-on] { opacity: 1; }

/* ---- the panel on the deck ---- */
.ct-rp { position: absolute; top: .6rem; right: .6rem; z-index: 9; width: min(23rem, calc(100% - 1.2rem)); max-height: calc(100% - 1.2rem); overflow: auto; display: flex; flex-direction: column; gap: .7rem; padding: .8rem; background: var(--ct-bg); border: 1px solid var(--ct-border); outline: none; font-size: .86rem; }
.ct-app .ct-rp:focus-visible { outline: none; }
:is(.ct-rp, .ct-rmt, .ct-pr) [hidden], .ct-rp[hidden] { display: none !important; }
.ct-rp-head { display: flex; align-items: center; gap: .5rem; }
.ct-rp h2 { margin: 0 auto 0 0; font-size: 1rem; font-weight: 800; }
.ct-rp h3 { margin: 0; font-size: .86rem; font-weight: 800; }
.ct-rp p { margin: 0; color: var(--ct-muted); line-height: 1.5; }
.ct-rp-ask { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; padding: .6rem .7rem; background: var(--ct-tint); }
.ct-rp-ask h3 { flex-basis: 100%; }
.ct-rp-code { font: 800 1.9rem/1 var(--ct-mono); letter-spacing: .14em; margin-right: auto; }
.ct-rp-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.ct-rp-row > :last-child { margin-left: auto; }
.ct-rp-modes { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
.ct-rp-modes[hidden], .ct-rp-qr[hidden] { display: none; }
.ct-rp-qrs { display: grid; justify-items: center; }
.ct-rp-qr { margin: 0; display: flex; flex-direction: column; gap: .35rem; min-width: 0; width: min(100%, 15rem); }
.ct-rp-img { aspect-ratio: 1; background: #fff; border: 1px solid var(--ct-border); }
.ct-rp-img svg { display: block; width: 100%; height: 100%; }
.ct-rp-url { font: .62rem/1.35 var(--ct-mono); color: var(--ct-muted); overflow-wrap: anywhere; }
.ct-rp-time { font: 700 1rem/1 var(--ct-mono); }
.ct-app .ct-btn[data-ct-primary], .ct-app .ct-btn[data-ct-primary]:hover { background: var(--ct-accent); color: var(--ct-accent-fg); border-color: var(--ct-accent); }
/* A touch screen keeps :hover on the last button tapped; there the tint would stay on it. */
@media (hover: none) { .ct-app .ct-btn:not([data-ct-primary], [aria-pressed="true"]):hover { background: var(--ct-bg); } }

/* ---- a page of the deck drawn small: the same rules as the stage, on a 1280 px wide sheet scaled down ---- */
.ct-pv { position: relative; overflow: hidden; aspect-ratio: var(--ct-ratio, 16 / 9); background: var(--ct-bg); border: 1px solid var(--ct-border); }
.ct-app .ct-pv > .ct-stage { inset: auto; left: 0; top: 0; width: 1280px; height: calc(1280px / var(--ct-ratio, 16 / 9)); transform: scale(var(--ct-k, .25)); transform-origin: 0 0; border: 0; z-index: 0; visibility: visible; pointer-events: none; }
.ct-pvw { height: 100%; overflow: hidden; }
/* The copy shows the page as it stands, revealed: a host's entrance motion would hold it at its first frame (often transparent), since the copy is never the current page. */
.ct-pv.ct-pv > .ct-stage *, .ct-pv.ct-pv > .ct-stage *::before, .ct-pv.ct-pv > .ct-stage *::after { animation: none !important; transition: none !important; }

/* ---- the phone ---- */
.ct-app.ct-rmt { display: flex; flex-direction: column; grid-template-rows: none; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); font-size: 1rem; -webkit-user-select: none; user-select: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.ct-rmt .ct-btn { min-height: 3rem; font-size: .8rem; padding: .5rem .3rem; touch-action: manipulation; }
.ct-rmt-top { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .6rem; padding: .55rem .8rem; background: var(--ct-panel); }
.ct-rmt-st[data-st="granted"] { background: var(--ct-fg); color: var(--ct-bg); }
.ct-rmt-st[data-st="offline"] { background: var(--ct-accent); color: var(--ct-accent-fg); }
.ct-rmt-pos { font: 650 .74rem/1 var(--ct-mono); }
.ct-rmt-time { margin-left: auto; font: 800 1.15rem/1 var(--ct-mono); }
.ct-rmt-time[data-over], .ct-rmt-blk b[data-over] { color: var(--ct-accent); }
.ct-rmt-blk { flex-basis: 100%; display: flex; gap: .5rem; font-size: .78rem; color: var(--ct-muted); min-width: 0; }
.ct-rmt-blk span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: auto; }
.ct-rmt-blk b { font: 650 .78rem/1.5 var(--ct-mono); color: var(--ct-fg); white-space: nowrap; }
.ct-rmt-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: .35rem; padding: .55rem .8rem 0; }
.ct-rmt-main { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .6rem; padding: .7rem .8rem; overflow: hidden; }
.ct-rmt-notes { flex: 1; min-height: 0; overflow: auto; font-size: 1.22rem; line-height: 1.75; -webkit-user-select: text; user-select: text; overscroll-behavior: contain; }
.ct-rmt-notes p { margin: 0 0 .8em; }
.ct-rmt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
.ct-rmt-list .ct-btn { width: 100%; display: flex; align-items: baseline; gap: .6rem; text-align: left; font: inherit; font-size: 1rem; font-weight: 700; letter-spacing: 0; padding: .7rem .8rem; white-space: normal; }
.ct-rmt-list .ct-btn[aria-current="true"] { background: var(--ct-tint); }
.ct-rmt-list .ct-btn > :nth-child(3) { margin-left: auto; }
.ct-rmt-padbox { flex: 1; min-height: 0; display: grid; place-items: end center; container-type: size; }
.ct-rmt-pad { position: relative; width: min(100cqw, 100cqh * var(--ct-ratio, 16 / 9)); touch-action: none; cursor: crosshair; }
.ct-rmt-pad .ct-ink { z-index: 2; }
.ct-rmt-dot { position: absolute; left: 0; top: 0; z-index: 3; width: 18px; height: 18px; margin: -9px; border-radius: 50%; background: #ff2d1a; box-shadow: 0 0 0 2px #fff; pointer-events: none; opacity: 0; }
.ct-rmt-dot[data-on] { opacity: 1; }
.ct-rmt-dot[data-target] { opacity: 1; background: none; box-shadow: 0 0 0 3px var(--ct-accent), 0 0 0 6px var(--ct-bg); width: 30px; height: 30px; margin: -15px; }
.ct-rmt-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
.ct-rmt-tools p { margin: 0; flex: 1 1 100%; font-size: .82rem; line-height: 1.5; color: var(--ct-muted); }
.ct-rmt-tools .ct-btn { flex: 1; }
.ct-rmt-tools .ct-rmt-hold { flex: 1 1 100%; min-height: 5rem; font-size: 1.1rem; }
.ct-rmt .ct-rmt-hold[aria-pressed="true"] { background: var(--ct-accent); color: var(--ct-accent-fg); border-color: var(--ct-accent); }
.ct-rmt-next { display: flex; align-items: baseline; gap: .5rem; padding: .5rem .8rem; background: var(--ct-panel); font-size: .88rem; min-width: 0; }
.ct-rmt-next span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-rmt-nav { display: grid; grid-template-columns: repeat(4, 1fr); gap: .35rem; padding: .55rem .8rem; }
.ct-rmt .ct-rmt-go { margin: 0 .8rem .8rem; min-height: 5.4rem; font-size: 1.5rem; letter-spacing: .12em; }
.ct-rmt-card { margin: auto; padding: 1.5rem 1.2rem; display: flex; flex-direction: column; align-items: center; gap: 1rem; text-align: center; max-width: 24rem; }
.ct-rmt-card p { margin: 0; line-height: 1.6; }
.ct-rmt-card .ct-btn { min-width: 12rem; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
.ct-rmt-code { font: 800 4.6rem/1 var(--ct-mono); letter-spacing: .12em; padding-left: .12em; }
.ct-rmt:not([data-ct-phase="granted"]) > :not(.ct-rmt-card), .ct-rmt[data-ct-phase="granted"] > .ct-rmt-card { display: none; }
.ct-rmt[data-ct-tab="notes"] :is(.ct-rmt-padbox, .ct-rmt-tools), .ct-rmt:not([data-ct-tab="notes"]) .ct-rmt-notes { display: none; }
.ct-rmt-tools > [data-for]:not([data-show]) { display: none; }
/* A phone on its side: the page and the tools on the left, the step buttons on the right. */
@media (orientation: landscape) and (max-height: 520px) {
  .ct-app.ct-rmt[data-ct-phase="granted"] { display: grid; grid-template: "top top" auto "tabs next" auto "main nav" minmax(0, 1fr) "main go" auto / minmax(0, 3fr) minmax(0, 2fr); }
  .ct-rmt-top { grid-area: top; padding-block: .35rem; }
  .ct-rmt-blk { flex-basis: auto; flex: 1; order: 1; }
  .ct-rmt-time { order: 2; }
  .ct-rmt-tabs { grid-area: tabs; }
  .ct-rmt-main { grid-area: main; flex-direction: row; }
  .ct-rmt-tools { flex: 0 0 38%; align-content: start; }
  .ct-rmt-next { grid-area: next; margin: .55rem .8rem 0 0; }
  .ct-rmt-nav { grid-area: nav; grid-template-columns: 1fr 1fr; padding-left: 0; align-content: start; }
  .ct-rmt .ct-rmt-go { grid-area: go; margin-left: 0; min-height: 4.2rem; }
  .ct-rmt .ct-rmt-tools .ct-rmt-hold { min-height: 3.6rem; }
}

/* ---- the presenter window ---- */
.ct-app.ct-pr { display: grid; grid-template: "top top" auto "now notes" minmax(0, 3fr) "next notes" minmax(0, 2fr) / minmax(0, 3fr) minmax(0, 2fr); gap: .8rem; padding: .8rem; }
.ct-pr-top { grid-area: top; display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1rem; }
.ct-pr-top .ct-rmt-time { margin-left: auto; font-size: 1.8rem; }
.ct-pr-top .ct-rmt-blk { flex-basis: auto; align-items: baseline; }
.ct-pr-cell { min-height: 0; min-width: 0; display: flex; flex-direction: column; gap: .4rem; }
.ct-pr-cell > h2 { margin: 0; display: flex; align-items: baseline; gap: .6rem; font: 650 .7rem/1 var(--ct-mono); letter-spacing: .12em; color: var(--ct-muted); }
.ct-pr-cell > h2 > span { letter-spacing: 0; font: 700 .9rem/1.2 inherit; font-family: inherit; color: var(--ct-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-pr-box { flex: 1; min-height: 0; display: grid; place-items: center start; container-type: size; }
.ct-pr-box .ct-pv { width: min(100cqw, 100cqh * var(--ct-ratio, 16 / 9)); }
.ct-pr-notes { grid-area: notes; overflow: auto; padding: .9rem 1rem; border: 1px solid var(--ct-border); font-size: 1.35rem; line-height: 1.75; }
.ct-pr-notes p { margin: 0 0 .8em; }
.ct-pr[data-ct-wait] :is(.ct-pr-cell, .ct-pr-notes) { opacity: .35; }
@media (max-width: 760px) {
  .ct-app.ct-pr { grid-template: "top" auto "now" minmax(0, 2fr) "notes" minmax(0, 3fr) / minmax(0, 1fr); }
  .ct-pr-cell[data-next] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ct-laser { transition: none; }
}
`;

/** Adds the stylesheet once per document. `nonce` is for a host with a `style-src` policy. */
export function injectStyle(nonce?: string): void {
  if (document.querySelector("style[data-ct-remote]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-ct-remote", "");
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  document.head.prepend(style);
}
