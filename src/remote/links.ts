/** Links to the other views of this page: the same URL with its own `view` (and `room`), without position or fragment. */
export function pageLink(view: "remote" | "presenter" | "notes" | null, room?: string): string {
  const url = new URL(location.href);
  for (const name of ["view", "at", "room"]) url.searchParams.delete(name);
  url.hash = "";
  if (view) url.searchParams.set("view", view);
  if (room) url.searchParams.set("room", room);
  return url.href;
}
