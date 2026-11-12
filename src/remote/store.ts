/** What survives a reload, in `sessionStorage`: one tab, one talk. Storage may be unavailable; then nothing is kept. */

/** The host's room, token, and clock, per page. Its presence means "the remote was on in this tab". */
export const hostKey = () => `contour-deck:host:${location.pathname}`;
/** The guest's resume token for a room. */
export const guestKey = (room: string) => `contour-deck:guest:${room}`;
/** The tilt calibration of this session. */
export const TILT_KEY = "contour-deck:tilt";

export function load(key: string): unknown {
  try {
    const text = sessionStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the session works, it only does not survive a reload.
  }
}
