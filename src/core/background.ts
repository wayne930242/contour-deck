/**
 * Page backgrounds on the stage: the video of a `[data-ct-background]` plays only while its page is current.
 *
 * The element holds its still (`<img>`) from the producer. On `show(page)` the core puts the moving media over it,
 * a muted `<video>` or a YouTube embed, and fades the still out only once playback has started; on the next `show`
 * the media is removed, so a hidden page never plays. With reduced motion, or when the media fails, the still stays.
 */

/** The class of the media element the core adds, and the attribute it sets once playback has started. */
export const MEDIA = "ct-bgm";
const PLAYING = "data-ct-playing";

interface Mounted {
  stop(): void;
}

const seconds = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function playVideo(box: HTMLElement, src: string, start: number, end: number): Mounted {
  const video = document.createElement("video");
  video.className = MEDIA;
  video.muted = video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  const play = () => void video.play().catch(() => {});
  const restart = () => {
    video.currentTime = start;
    play();
  };
  video.addEventListener("loadedmetadata", () => {
    if (start) video.currentTime = start;
  });
  video.addEventListener("playing", () => video.setAttribute(PLAYING, ""));
  video.addEventListener("timeupdate", () => {
    if (end && video.currentTime >= end) restart();
  });
  video.addEventListener("ended", restart);
  // A video that cannot load leaves the still in place.
  video.addEventListener("error", () => video.remove());
  video.src = src;
  box.append(video);
  play();
  return {
    stop() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}

/** The YouTube embed: no-cookie, muted, no controls, no keyboard; looped from `start` to `end` over postMessage. */
export function youtubeUrl(id: string, start: number, end: number, origin: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    rel: "0",
    disablekb: "1",
    playsinline: "1",
    fs: "0",
    iv_load_policy: "3",
    modestbranding: "1",
    enablejsapi: "1",
  });
  if (start) params.set("start", String(Math.floor(start)));
  if (end) params.set("end", String(Math.ceil(end)));
  if (/^https?:/.test(origin)) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
}

function playYoutube(box: HTMLElement, id: string, start: number, end: number): Mounted {
  const frame = document.createElement("iframe");
  frame.className = MEDIA;
  frame.src = youtubeUrl(id, start, end, location.origin);
  frame.title = "";
  frame.allow = "autoplay; encrypted-media";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  const abort = new AbortController();
  const post = (message: object) => frame.contentWindow?.postMessage(JSON.stringify(message), "*");
  const command = (func: string, args: unknown[] = []) => post({ event: "command", func, args });
  const restart = () => {
    command("seekTo", [start, true]);
    command("playVideo");
  };
  frame.addEventListener(
    "load",
    () => {
      post({ event: "listening", id: 1, channel: "widget" });
      command("addEventListener", ["onStateChange"]);
    },
    { signal: abort.signal }
  );
  window.addEventListener(
    "message",
    event => {
      if (event.source !== frame.contentWindow || typeof event.data !== "string") return;
      let data: { event?: string; info?: unknown };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const info = data.info as { playerState?: number; currentTime?: number } | number | null | undefined;
      if (data.event === "onReady") {
        command("mute");
        command("playVideo");
      }
      const state = typeof info === "number" ? info : info?.playerState;
      // 1 playing, 0 ended (the embed's `end` stops it there).
      if (state === 1) frame.setAttribute(PLAYING, "");
      if (state === 0) restart();
      const time = typeof info === "object" ? info?.currentTime : undefined;
      if (end && typeof time === "number" && time >= end) restart();
    },
    { signal: abort.signal }
  );
  box.append(frame);
  return {
    stop() {
      abort.abort();
      frame.remove();
    },
  };
}

export interface Backgrounds {
  /** Plays the background of `page`, if it has a moving one, and stops the one before. `null` stops it. */
  show(page: HTMLElement | null): void;
}

export function createBackgrounds(reduced: () => boolean): Backgrounds {
  let mounted: Mounted | null = null;
  return {
    show(page) {
      mounted?.stop();
      mounted = null;
      const box = page && Array.from(page.children).find(child => child.hasAttribute("data-ct-background"));
      if (!(box instanceof HTMLElement) || reduced()) return;
      const { video, youtube, start, end } = box.dataset;
      if (video) mounted = playVideo(box, video, seconds(start), seconds(end));
      else if (youtube) mounted = playYoutube(box, youtube, seconds(start), seconds(end));
    },
  };
}
