/** The talk clock: time since the first move on the stage, and the time spent in each block. No DOM. */

/** What the clock keeps; plain data, so the host can put it in `sessionStorage` and survive a reload. */
export interface ClockState {
  /** `Date.now()` of the start, or `null` while the talk has not started. */
  started: number | null;
  /** 0-based index of the block the deck is in. */
  block: number;
  /** When the deck entered that block. */
  since: number;
  /** Milliseconds already spent in each block before `since`, by block index. */
  spent: Record<number, number>;
}

export interface ClockReading {
  /** Seconds since the start, one decimal; 0 before the start and at least 0.1 after it. */
  elapsed: number;
  /** Seconds spent in the current block since the start, all visits together. */
  blockElapsed: number;
}

export interface Clock {
  readonly running: boolean;
  readonly state: ClockState;
  start(block: number, now: number): void;
  /** The deck is in `block` now; a no-op before the start. */
  enter(block: number, now: number): void;
  reset(): void;
  read(now: number): ClockReading;
}

const idle = (): ClockState => ({ started: null, block: 0, since: 0, spent: {} });
const seconds = (ms: number) => Math.round(ms / 100) / 10;

export function createClock(restored?: ClockState | null): Clock {
  let state = restored ? { ...restored, spent: { ...restored.spent } } : idle();
  return {
    get running() {
      return state.started !== null;
    },
    get state() {
      return state;
    },
    start(block, now) {
      state = { started: now, block, since: now, spent: {} };
    },
    enter(block, now) {
      if (state.started === null || block === state.block) return;
      state.spent[state.block] = (state.spent[state.block] ?? 0) + now - state.since;
      state.block = block;
      state.since = now;
    },
    reset() {
      state = idle();
    },
    read(now) {
      if (state.started === null) return { elapsed: 0, blockElapsed: 0 };
      return {
        elapsed: Math.max(0.1, seconds(now - state.started)),
        blockElapsed: seconds((state.spent[state.block] ?? 0) + now - state.since),
      };
    },
  };
}

/** Planned seconds of the talk: the minutes of every block the linear advance enters, or `null` when none has any. */
export function plannedSeconds(blocks: { minutes: number; kind: string }[], skip: string[]): number | null {
  const minutes = blocks.reduce((sum, block) => sum + (skip.includes(block.kind) ? 0 : block.minutes), 0);
  return minutes > 0 ? Math.round(minutes * 60) : null;
}

/** `m:ss`, or `h:mm:ss` from one hour. */
export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const two = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours}:${two(minutes)}:${two(whole % 60)}` : `${minutes}:${two(whole % 60)}`;
}
