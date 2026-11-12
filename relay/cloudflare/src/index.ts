import { canonicalRoom, isRole, originAllowed, roomOfKey } from "./protocol";

export { Room } from "./room";

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v1/health") {
      return request.method === "GET" || request.method === "HEAD" ? text(200, "ok") : text(405, "method not allowed");
    }

    const match = /^\/v1\/room\/([^/]+)$/.exec(url.pathname);
    if (!match?.[1]) return text(404, "not found");
    if (request.method !== "GET") return text(405, "method not allowed");
    // Every room request from one address counts, refused or not: a loop of opens cannot spend the daily quota.
    const { success } = await env.UPGRADES.limit({ key: request.headers.get("CF-Connecting-IP") ?? "" });
    if (!success) return text(429, "too many requests");
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) return text(403, "origin not allowed");

    const room = canonicalRoom(match[1]);
    if (room === null) return text(400, "bad room id");
    const role = url.searchParams.get("role");
    if (!isRole(role)) return text(400, "bad role");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return text(426, "expected a WebSocket upgrade");
    // The host seat needs the key whose hash is the room; the QR on the screen carries the room only.
    if (role === "host" && (await roomOfKey(url.searchParams.get("key") ?? "")) !== room) return text(403, "bad host key");

    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
