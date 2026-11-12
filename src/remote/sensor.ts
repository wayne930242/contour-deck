/** The orientation sensor of the phone: permission (iOS asks, and only on a tap), events, and the screen's turn. */
import { aimOf } from "./tilt.js";
import type { Aim } from "./tilt.js";

export type SensorResult = "ok" | "denied" | "unsupported";

export interface Sensor {
  /** Asks for the sensor. Call it from a tap: iOS shows its permission prompt only then. */
  start(): Promise<SensorResult>;
  stop(): void;
}

/**
 * A static permission request on the event constructor: iOS 13+ answers `granted` or `denied` after its prompt,
 * Chromium answers `granted`, `denied`, or `prompt` (no decision; readings may still come).
 */
interface PermissionGate {
  requestPermission?: () => Promise<string>;
}

/** How long to wait for the first reading before deciding there is no sensor (a desktop browser). */
const FIRST_READING = 1500;

function screenAngle(): number {
  const legacy = (window as { orientation?: number | string }).orientation;
  return screen.orientation?.angle ?? (Number(legacy) || 0);
}

/** Calls `onAim` with the direction the phone points at, and the time in seconds, for every reading. */
export function createSensor(onAim: (aim: Aim, t: number) => void): Sensor {
  let abort: AbortController | null = null;
  return {
    async start() {
      if (typeof DeviceOrientationEvent === "undefined") return "unsupported";
      const gate = DeviceOrientationEvent as unknown as PermissionGate;
      if (gate.requestPermission) {
        try {
          // Only a refusal ends it here; without a decision, the wait for a first reading below tells.
          if ((await gate.requestPermission()) === "denied") return "denied";
        } catch {
          return "denied";
        }
      }
      abort?.abort();
      abort = new AbortController();
      const { signal } = abort;
      return new Promise<SensorResult>(resolve => {
        const timer = window.setTimeout(() => {
          abort?.abort();
          resolve("unsupported");
        }, FIRST_READING);
        addEventListener(
          "deviceorientation",
          event => {
            const { alpha, beta, gamma } = event;
            if (alpha === null || beta === null || gamma === null) return;
            clearTimeout(timer);
            resolve("ok");
            onAim(aimOf({ alpha, beta, gamma }, screenAngle()), event.timeStamp / 1000);
          },
          { signal }
        );
      });
    },
    stop() {
      abort?.abort();
      abort = null;
    },
  };
}
