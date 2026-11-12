/**
 * Pointing with the phone: from device orientation to a point on the screen. Pure math, no sensors:
 * the phone is held like a laser pointer, its top edge towards the screen, and five aimed samples
 * (centre and four corners) calibrate where the screen is in the room.
 */

/** A `deviceorientation` reading, in degrees. */
export interface TiltSample {
  alpha: number;
  beta: number;
  gamma: number;
}

/** Where the phone points, in radians: `yaw` grows to the left (counter-clockwise from above), `pitch` grows upwards. */
export interface Aim {
  yaw: number;
  pitch: number;
}

/**
 * The screen as seen from where the presenter stands: the aim at its centre, and the signed angle
 * from the centre to each edge. Left and right have opposite signs, and so have top and bottom.
 */
export interface Calibration extends Aim {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export type CalibrationTarget = "centre" | "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

/** The order the guided calibration asks for. */
export const CALIBRATION_TARGETS: readonly CalibrationTarget[] = ["centre", "topLeft", "topRight", "bottomRight", "bottomLeft"];

const RAD = Math.PI / 180;
/** A screen edge closer than this to the centre means the samples were not aimed at corners. */
const MIN_RANGE = 2 * RAD;
const MAX_RANGE = 80 * RAD;

/** An angle difference brought into (-π, π], so 358° to 2° is +4° and not -356°. */
export function wrap(angle: number): number {
  const turn = 2 * Math.PI;
  const reduced = ((angle % turn) + turn) % turn;
  return reduced > Math.PI ? reduced - turn : reduced;
}

/**
 * The direction the top of the screen points at, from a sensor reading.
 * The reading becomes the rotation matrix R = Rz(alpha)·Rx(beta)·Ry(gamma) of the W3C specification, and
 * the pointing axis is the edge at the top of the screen as it is turned now (`screenAngle`, the value of
 * `screen.orientation.angle`): the device's +Y in portrait, +X after a quarter turn. Reading the axis in
 * the room, and not the three angles one by one, keeps the aim independent of how the wrist is rolled.
 */
export function aimOf({ alpha, beta, gamma }: TiltSample, screenAngle = 0): Aim {
  const [a, b, g, s] = [alpha * RAD, beta * RAD, gamma * RAD, screenAngle * RAD];
  const [cA, sA, cB, sB, cG, sG] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  // Columns 1 and 2 of R: the device's X and Y axes in room coordinates (east, north, up).
  const xAxis = [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG];
  const yAxis = [-cB * sA, cA * cB, sB];
  const [east, north, up] = [0, 1, 2].map(i => Math.sin(s) * xAxis[i] + Math.cos(s) * yAxis[i]);
  return { yaw: Math.atan2(-east, north), pitch: Math.asin(Math.min(1, Math.max(-1, up))) };
}

const mean = (a: number, b: number) => (a + b) / 2;

/** The average of a few readings taken close together (the hand shakes when the thumb taps), across the yaw seam. */
export function meanAim(aims: readonly Aim[]): Aim {
  const last = aims[aims.length - 1];
  let yaw = 0;
  let pitch = 0;
  for (const aim of aims) {
    yaw += wrap(aim.yaw - last.yaw);
    pitch += aim.pitch;
  }
  return { yaw: wrap(last.yaw + yaw / aims.length), pitch: pitch / aims.length };
}

/**
 * The calibration from the five aimed samples, or `null` when they cannot be a screen:
 * an edge too close to the centre, or both sides of the centre on the same side.
 */
export function calibrate(aims: Record<CalibrationTarget, Aim>): Calibration | null {
  const { centre } = aims;
  const yaw = (target: CalibrationTarget) => wrap(aims[target].yaw - centre.yaw);
  const pitch = (target: CalibrationTarget) => aims[target].pitch - centre.pitch;
  const calibration = {
    yaw: centre.yaw,
    pitch: centre.pitch,
    left: mean(yaw("topLeft"), yaw("bottomLeft")),
    right: mean(yaw("topRight"), yaw("bottomRight")),
    top: mean(pitch("topLeft"), pitch("topRight")),
    bottom: mean(pitch("bottomLeft"), pitch("bottomRight")),
  };
  return isCalibration(calibration) ? calibration : null;
}

/** True for a calibration that maps to a screen; also the check for one read back from storage. */
export function isCalibration(value: unknown): value is Calibration {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const numbers = [c.yaw, c.pitch, c.left, c.right, c.top, c.bottom];
  if (!numbers.every((n): n is number => typeof n === "number" && Number.isFinite(n))) return false;
  const [, , left, right, top, bottom] = numbers;
  const inRange = (edge: number) => Math.abs(edge) >= MIN_RANGE && Math.abs(edge) <= MAX_RANGE;
  return [left, right, top, bottom].every(inRange) && left * right < 0 && top * bottom < 0;
}

/** A calibration for a screen of ordinary size seen from the middle of a room: ±20° wide, ±12° high around `centre`. */
export function defaultCalibration(centre: Aim): Calibration {
  return { yaw: centre.yaw, pitch: centre.pitch, left: 20 * RAD, right: -20 * RAD, top: 12 * RAD, bottom: -12 * RAD };
}

/** Half the screen on each side of the centre, each side with its own range: 0 at the `low` edge, 1 at the `high` edge. */
const along = (delta: number, low: number, high: number) => 0.5 + (delta * low > 0 ? -delta / low : delta / high) / 2;

/** The aimed point in screen coordinates, origin at the top left; outside [0, 1] when the aim is past an edge. */
export function project(calibration: Calibration, aim: Aim): Point {
  return {
    x: along(wrap(aim.yaw - calibration.yaw), calibration.left, calibration.right),
    y: along(aim.pitch - calibration.pitch, calibration.top, calibration.bottom),
  };
}

/** The same screen size, with the centre where the phone points now: the answer to drift, or to a step sideways. */
export function recentre(calibration: Calibration, aim: Aim): Calibration {
  return { ...calibration, yaw: aim.yaw, pitch: aim.pitch };
}

/**
 * Drift correction while pointing: an aim past an edge drags the calibration along, so the edge stays
 * under the aim and the pointer answers at once when the hand comes back, as a mouse does at the screen edge.
 */
export function follow(calibration: Calibration, aim: Aim): Calibration {
  const { x, y } = project(calibration, aim);
  let { yaw, pitch } = calibration;
  if (x < 0) yaw = aim.yaw - calibration.left;
  else if (x > 1) yaw = aim.yaw - calibration.right;
  if (y < 0) pitch = aim.pitch - calibration.top;
  else if (y > 1) pitch = aim.pitch - calibration.bottom;
  return yaw === calibration.yaw && pitch === calibration.pitch ? calibration : { ...calibration, yaw, pitch };
}

/**
 * The 1€ filter (Casiez, Roussel, Vogel 2012): a low-pass whose cutoff rises with speed, so a still hand
 * gives a still pointer and a fast sweep is not held back. `t` is in seconds.
 */
export function oneEuro(minCutoff = 1.2, beta = 8, derivativeCutoff = 1): (value: number, t: number) => number {
  const share = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  let held: number | null = null;
  let speed = 0;
  let last = 0;
  return (value, t) => {
    if (held === null) {
      held = value;
      last = t;
      return value;
    }
    const dt = Math.max(1e-3, t - last);
    last = t;
    speed += share(derivativeCutoff, dt) * ((value - held) / dt - speed);
    held += share(minCutoff + beta * Math.abs(speed), dt) * (value - held);
    return held;
  };
}

export interface Pointer {
  /** The calibration in force; `follow` moves it while the phone points past an edge. */
  calibration: Calibration;
  /** The smoothed point of an aim, clamped to the screen. `t` is in seconds. */
  update(aim: Aim, t: number): Point;
  /** Puts the centre where the phone points and forgets the filter's history. */
  recentre(aim: Aim): void;
}

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** Calibration, drift correction, and smoothing in one: feed it aims, read points. */
export function createPointer(calibration: Calibration): Pointer {
  let filters = [oneEuro(), oneEuro()];
  return {
    calibration,
    update(aim, t) {
      this.calibration = follow(this.calibration, aim);
      const { x, y } = project(this.calibration, aim);
      return { x: unit(filters[0](unit(x), t)), y: unit(filters[1](unit(y), t)) };
    },
    recentre(aim) {
      this.calibration = recentre(this.calibration, aim);
      filters = [oneEuro(), oneEuro()];
    },
  };
}
