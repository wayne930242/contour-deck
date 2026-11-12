/** The remote panel on the deck: the QR codes, the pairing requests, the paired phone, and the presenter window. */
import { h } from "../core/dom.js";
import { formatClock } from "./clock.js";
import type { RemoteLabels } from "./labels.js";
import type { PairRequest } from "./pairing.js";
import type { TransportStatus } from "./transport.js";

/** Draws a QR code as an SVG string; `null` (or a rejection) shows the link as text only. */
export type QrEncoder = (text: string) => string | null | Promise<string | null>;

/** What the panel shows; the host session hands in a new one on every change. */
export interface PanelView {
  /** `null` without a relay. */
  relay: TransportStatus | null;
  /** Close code of the last relay connection. */
  code: number;
  requests: readonly PairRequest[];
  paired: "no" | "online" | "offline";
  elapsed: number;
}

export interface PanelOptions {
  /** The viewport of the deck's shell (`.ct-vp`). */
  parent: HTMLElement;
  labels: RemoteLabels;
  qr: QrEncoder;
  /** The phone-remote link, or `null` without a relay. */
  remoteLink: string | null;
  notesLink: string;
  allow(id: string): void;
  deny(id: string): void;
  revoke(): void;
  presenter(): void;
  resetTimer(): void;
  end(): void;
  close(): void;
}

export interface Panel {
  readonly open: boolean;
  show(open: boolean): void;
  update(view: PanelView): void;
  destroy(): void;
}

export function createPanel(options: PanelOptions): Panel {
  const { labels } = options;
  const el = h("aside", "ct-rp", "", { role: "dialog", "aria-label": labels.title, tabindex: -1 });
  el.hidden = true;
  const button = (action: string, text: string, primary = false) => {
    const control = h("button", "ct-btn", text, { "data-ct-rp": action });
    if (primary) control.setAttribute("data-ct-primary", "");
    return control;
  };

  const head = el.appendChild(h("div", "ct-rp-head"));
  const status = h("span", "ct-badge");
  const closeButton = button("close", "✕");
  closeButton.setAttribute("aria-label", labels.close);
  head.append(h("h2", "", labels.title), status, closeButton);
  /** Requests and the paired phone: the part that changes. */
  const live = el.appendChild(h("div", "ct-rp-live", "", { "aria-live": "polite" }));
  live.style.display = "contents";

  const codes = el.appendChild(h("div", "ct-rp-qrs"));
  function tile(title: string, hint: string, link: string) {
    const figure = codes.appendChild(h("figure", "ct-rp-qr"));
    const image = h("div", "ct-rp-img");
    image.hidden = true;
    figure.append(image, h("h3", "", title), h("p", "", hint), h("a", "ct-rp-url", link, { href: link, target: "_blank", rel: "noopener" }));
    // The encoder belongs to the host page (or is the built-in one): its SVG goes in as markup.
    void Promise.resolve()
      .then(() => options.qr(link))
      .then(svg => {
        if (!svg) return;
        image.innerHTML = svg;
        image.hidden = false;
      })
      .catch(() => {});
  }
  if (options.remoteLink) tile(labels.remoteQr, labels.remoteHint, options.remoteLink);
  else codes.before(h("p", "", labels.noRelay));
  tile(labels.notesQr, labels.notesHint, options.notesLink);

  const tools = el.appendChild(h("div", "ct-rp-row"));
  const time = h("b", "ct-rp-time", "0:00");
  const timer = h("span", "ct-rp-row");
  timer.append(h("span", "ct-meta", labels.timer), time, button("reset", labels.resetTimer));
  tools.append(button("presenter", labels.presenter), timer);
  el.appendChild(h("div", "ct-rp-row")).append(h("span"), button("end", labels.end));

  const actions: Record<string, (id: string) => void> = {
    close: options.close,
    allow: options.allow,
    deny: options.deny,
    revoke: options.revoke,
    presenter: options.presenter,
    reset: options.resetTimer,
    end: options.end,
  };
  el.addEventListener("click", event => {
    const control = (event.target as Element).closest<HTMLElement>("[data-ct-rp]");
    if (control) actions[control.dataset.ctRp ?? ""]?.(control.dataset.ctId ?? "");
  });
  // Escape closes the panel, and only the panel: the deck's own Escape (outline, exit) does not run.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || el.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    options.close();
  };
  document.addEventListener("keydown", onKey, true);
  options.parent.append(el);

  let returnTo: HTMLElement | null = null;
  let drawn = "";

  return {
    get open() {
      return !el.hidden;
    },
    show(open) {
      if (open === !el.hidden) return;
      el.hidden = !open;
      if (open) {
        returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.focus({ preventScroll: true });
      } else {
        returnTo?.focus({ preventScroll: true });
        returnTo = null;
      }
    },
    update(view) {
      time.textContent = formatClock(view.elapsed);
      const relayText =
        view.relay === null
          ? ""
          : view.relay === "open"
            ? labels.relayOpen
            : view.code === 4009
              ? labels.roomTaken
              : view.relay === "closed"
                ? labels.relayClosed
                : labels.relayConnecting;
      status.textContent = relayText;
      status.hidden = !relayText;
      status.dataset.st = view.relay ?? "";
      // The requests are rebuilt only when they change, so a button under the finger stays the same element.
      const key = JSON.stringify([view.requests, view.paired]);
      if (key === drawn) return;
      drawn = key;
      live.replaceChildren(
        ...view.requests.map(request => {
          const ask = h("section", "ct-rp-ask", "", { "data-ct-id": request.id });
          const allow = button("allow", labels.allow, true);
          const deny = button("deny", labels.deny);
          allow.dataset.ctId = deny.dataset.ctId = request.id;
          const code = h("b", "ct-rp-code", request.code, { "aria-label": `${labels.code} ${request.code.split("").join(" ")}` });
          ask.append(h("h3", "", labels.request), h("span", "ct-meta", labels.code), code, allow, deny);
          return ask;
        })
      );
      if (view.paired !== "no") {
        const paired = live.appendChild(h("div", "ct-rp-row"));
        paired.append(h("span", "ct-badge", view.paired === "online" ? labels.paired : labels.pairedOffline), button("revoke", labels.revoke));
      }
    },
    destroy() {
      document.removeEventListener("keydown", onKey, true);
      el.remove();
    },
  };
}
