import { canonicalRoom, isRole, originAllowed } from "./protocol";

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
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) return text(403, "origin not allowed");

    const room = canonicalRoom(match[1]);
    if (room === null) return text(400, "bad room id");
    if (!isRole(url.searchParams.get("role"))) return text(400, "bad role");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return text(426, "expected a WebSocket upgrade");

    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
