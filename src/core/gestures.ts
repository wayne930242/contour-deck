/**
 * Turns a stream of wheel events into single steps: one gesture moves one stop.
 * A trackpad keeps sending shrinking deltas after the fingers lift (the inertia tail);
 * those are ignored until a pause, or a clearly larger delta, marks a new gesture.
 */
export function createWheelGate(lockMs = 420, gapMs = 140) {
  let lockedUntil = 0;
  let inTail = false;
  let lastTime = -Infinity;
  let lastSize = 0;

  /** Returns the step to take for this event: 1 down, -1 up, 0 none. */
  return (deltaY: number, now: number, blocked = false): 1 | -1 | 0 => {
    const size = Math.abs(deltaY);
    if (now - lastTime > gapMs || size > lastSize * 1.7 + 6) inTail = false;
    lastTime = now;
    lastSize = size;
    if (blocked || now < lockedUntil || inTail || size < 3) return 0;
    inTail = true;
    lockedUntil = now + lockMs;
    return deltaY > 0 ? 1 : -1;
  };
}
