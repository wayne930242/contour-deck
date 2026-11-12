/** Tilt pointing: fixed sensor samples through the calibration and the mapping. */
import { describe, expect, it } from "vitest";
import {
  aimOf,
  calibrate,
  createPointer,
  defaultCalibration,
  follow,
  isCalibration,
  oneEuro,
  project,
  recentre,
  wrap,
} from "../../../src/remote/tilt.js";
import type { Aim, CalibrationTarget, TiltSample } from "../../../src/remote/tilt.js";

const deg = (radians: number) => (radians * 180) / Math.PI;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const sample = (alpha: number, beta: number, gamma = 0): TiltSample => ({ alpha, beta, gamma });

/**
 * A presenter facing compass heading 358° (alpha wraps inside the screen), phone flat in the hand and raised 10°.
 * The screen spans 14° to the left, 16° to the right, 9° up and 7° down, and the hand is not steady:
 * the two samples of an edge differ by a degree.
 */
const AIMED: Record<CalibrationTarget, TiltSample> = {
  centre: sample(358, 10, 3),
  topLeft: sample(12.5, 19.5, -8),
  topRight: sample(342.5, 18.5, 14),
  bottomRight: sample(341.5, 2.5, 11),
  bottomLeft: sample(11.5, 3.5, -6),
};

const aims = (samples: Record<CalibrationTarget, TiltSample>, angle = 0) =>
  Object.fromEntries(Object.entries(samples).map(([target, value]) => [target, aimOf(value, angle)])) as Record<CalibrationTarget, Aim>;

describe("wrap", () => {
  it("keeps differences across the 0°/360° seam small", () => {
    expect(deg(wrap(rad(2) - rad(358)))).toBeCloseTo(4);
    expect(deg(wrap(rad(358) - rad(2)))).toBeCloseTo(-4);
    expect(deg(wrap(rad(190)))).toBeCloseTo(-170);
    expect(deg(wrap(rad(180)))).toBeCloseTo(180);
    expect(deg(wrap(rad(-540)))).toBeCloseTo(180);
  });
});

describe("aimOf", () => {
  it("reads yaw from alpha and pitch from beta when the phone points with its top edge", () => {
    const aim = aimOf(sample(30, 10));
    expect(deg(aim.yaw)).toBeCloseTo(30);
    expect(deg(aim.pitch)).toBeCloseTo(10);
    expect(aimOf(sample(0, 0)).yaw).toBeCloseTo(0, 12);
    expect(aimOf(sample(0, 0)).pitch).toBeCloseTo(0, 12);
  });

  it("does not move when only the wrist rolls", () => {
    const flat = aimOf(sample(30, 10, 0));
    for (const gamma of [-60, -25, 25, 60]) {
      const rolled = aimOf(sample(30, 10, gamma));
      expect(rolled.yaw).toBeCloseTo(flat.yaw, 10);
      expect(rolled.pitch).toBeCloseTo(flat.pitch, 10);
    }
  });

  it("points with the long edge after a quarter turn of the screen", () => {
    // Landscape, screen.orientation.angle 90: the device's +X is the top of the screen.
    const level = aimOf(sample(0, 0, 0), 90);
    expect(deg(level.yaw)).toBeCloseTo(-90);
    expect(deg(level.pitch)).toBeCloseTo(0);
    // Turning the body 20° to the left moves the aim 20° to the left; lifting that edge 10° raises it 10°.
    expect(deg(wrap(aimOf(sample(20, 0, 0), 90).yaw - level.yaw))).toBeCloseTo(20);
    expect(deg(aimOf(sample(0, 0, -10), 90).pitch)).toBeCloseTo(10);
    // The other landscape and upside-down portrait point the opposite edges.
    expect(deg(aimOf(sample(0, 0, 10), 270).pitch)).toBeCloseTo(10);
    expect(deg(aimOf(sample(0, -10, 0), 180).pitch)).toBeCloseTo(10);
  });
});

describe("calibrate and project", () => {
  const calibration = calibrate(aims(AIMED))!;

  it("measures the screen from five aimed samples, across the alpha seam", () => {
    expect(deg(calibration.yaw)).toBeCloseTo(-2); // 358°
    expect(deg(calibration.pitch)).toBeCloseTo(10);
    expect(deg(calibration.left)).toBeCloseTo(14);
    expect(deg(calibration.right)).toBeCloseTo(-16);
    expect(deg(calibration.top)).toBeCloseTo(9);
    expect(deg(calibration.bottom)).toBeCloseTo(-7);
  });

  it("maps the centre to the middle and each edge to 0 or 1", () => {
    const at = (alpha: number, beta: number) => project(calibration, aimOf(sample(alpha, beta)));
    expect(at(358, 10)).toEqual({ x: 0.5, y: 0.5 });
    expect(at(12, 19).x).toBeCloseTo(0);
    expect(at(12, 19).y).toBeCloseTo(0);
    expect(at(342, 3).x).toBeCloseTo(1);
    expect(at(342, 3).y).toBeCloseTo(1);
    // Halfway to an edge is a quarter of the screen, with each side on its own scale.
    expect(at(5, 10).x).toBeCloseTo(0.25);
    expect(at(350, 10).x).toBeCloseTo(0.75);
    expect(at(358, 14.5).y).toBeCloseTo(0.25);
    expect(at(358, 6.5).y).toBeCloseTo(0.75);
  });

  it("goes outside the unit square past an edge, without jumping at the seam", () => {
    const at = (alpha: number) => project(calibration, aimOf(sample(alpha, 10))).x;
    expect(at(19)).toBeCloseTo(-0.25);
    expect(at(334)).toBeCloseTo(1.25);
    // alpha 359.9° and 0.1° are neighbours.
    expect(Math.abs(at(359.9) - at(0.1))).toBeLessThan(0.01);
  });

  it("gives the same screen whichever way the presenter faces, also across yaw ±180°", () => {
    // The same room turned so the centre sits at alpha 178°: the left corners read 192°, past the seam of the yaw angle.
    for (const turn of [180, 90, 270, 2]) {
      const turned = Object.fromEntries(
        Object.entries(AIMED).map(([target, value]) => [target, { ...value, alpha: (value.alpha + turn) % 360 }])
      ) as Record<CalibrationTarget, TiltSample>;
      const facing = calibrate(aims(turned))!;
      for (const edge of ["left", "right", "top", "bottom"] as const) expect(facing[edge], `${edge} at ${turn}`).toBeCloseTo(calibration[edge], 6);
      const at = (alpha: number) => project(facing, aimOf(sample((alpha + turn) % 360, 10))).x;
      expect(at(5)).toBeCloseTo(0.25);
      expect(at(350)).toBeCloseTo(0.75);
      expect(at(19)).toBeCloseTo(-0.25);
    }
  });

  it("gives the same screen in landscape, where the other axes carry the aim", () => {
    // The same five directions, held in landscape: yaw still comes from alpha, pitch from -gamma.
    const landscape = Object.fromEntries(
      Object.entries(AIMED).map(([target, { alpha, beta }]) => [target, sample(alpha, 0, -beta)])
    ) as Record<CalibrationTarget, TiltSample>;
    const turned = calibrate(aims(landscape, 90))!;
    for (const edge of ["left", "right", "top", "bottom"] as const) expect(turned[edge]).toBeCloseTo(calibration[edge], 6);
    expect(project(turned, aimOf(sample(5, 0, -10), 90)).x).toBeCloseTo(0.25);
  });

  it("accepts a sensor that counts alpha the other way round", () => {
    const mirrored = Object.fromEntries(
      Object.entries(AIMED).map(([target, value]) => [target, { ...value, alpha: 360 - value.alpha }])
    ) as Record<CalibrationTarget, TiltSample>;
    const flipped = calibrate(aims(mirrored))!;
    expect(deg(flipped.left)).toBeCloseTo(-14);
    expect(project(flipped, aimOf(sample(360 - 12, 19))).x).toBeCloseTo(0);
    expect(project(flipped, aimOf(sample(360 - 342, 3))).x).toBeCloseTo(1);
  });

  it("rejects samples that are not a screen", () => {
    const still = Object.fromEntries(Object.keys(AIMED).map(target => [target, sample(358, 10)])) as typeof AIMED;
    expect(calibrate(aims(still))).toBeNull();
    // Every corner to the left of the centre.
    const oneSided = { ...AIMED, topRight: sample(5, 18), bottomRight: sample(4, 3) };
    expect(calibrate(aims(oneSided))).toBeNull();
    // An edge less than 2° from the centre.
    const thin = { ...AIMED, topLeft: sample(12, 11), topRight: sample(342, 11) };
    expect(calibrate(aims(thin))).toBeNull();
  });

  it("survives storage as JSON, and refuses what is not a calibration", () => {
    const restored: unknown = JSON.parse(JSON.stringify(calibration));
    expect(isCalibration(restored)).toBe(true);
    expect(restored).toEqual(calibration);
    expect(isCalibration({ ...calibration, left: null })).toBe(false);
    expect(isCalibration({ ...calibration, right: calibration.left })).toBe(false);
    expect(isCalibration("{}")).toBe(false);
  });
});

describe("drift", () => {
  const calibration = defaultCalibration(aimOf(sample(100, 0)));

  it("starts from a default screen of ±20° by ±12°", () => {
    const quarter = project(calibration, aimOf(sample(110, 6)));
    expect(quarter.x).toBeCloseTo(0.25, 10);
    expect(quarter.y).toBeCloseTo(0.25, 10);
    expect(isCalibration(calibration)).toBe(true);
  });

  it("re-centres on the current aim and keeps the size", () => {
    // The gyroscope drifted 9°: the presenter aims at the centre and taps.
    const drifted = aimOf(sample(109, 1));
    const fixed = recentre(calibration, drifted);
    expect(project(fixed, drifted)).toEqual({ x: 0.5, y: 0.5 });
    expect(fixed.left).toBe(calibration.left);
    expect(project(fixed, aimOf(sample(119, 1))).x).toBeCloseTo(0.25);
  });

  it("drags the screen along when the aim goes past an edge", () => {
    // 30° to the left of the centre is 10° past the left edge.
    const past = aimOf(sample(130, 0));
    const dragged = follow(calibration, past);
    expect(project(dragged, past).x).toBeCloseTo(0);
    expect(deg(wrap(dragged.yaw - calibration.yaw))).toBeCloseTo(10);
    // Coming back 20° now reaches the centre, not 10° short of it.
    expect(project(dragged, aimOf(sample(110, 0))).x).toBeCloseTo(0.5);
    // Inside the screen nothing moves: the same object comes back.
    expect(follow(calibration, aimOf(sample(95, 3)))).toBe(calibration);
    // Past the bottom edge the pitch is dragged the same way.
    const low = aimOf(sample(100, -20));
    expect(project(follow(calibration, low), low).y).toBeCloseTo(1);
  });
});

describe("oneEuro", () => {
  it("passes a constant through and settles a jittering one", () => {
    const filter = oneEuro();
    expect(filter(0.4, 0)).toBe(0.4);
    expect(filter(0.4, 1 / 60)).toBeCloseTo(0.4, 12);
    // ±0.01 of jitter at 60 Hz around 0.5: the output moves less than a fifth of that.
    const jitter = oneEuro();
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 240; i++) {
      const out = jitter(0.5 + (i % 2 ? 0.01 : -0.01), i / 60);
      if (i < 60) continue;
      low = Math.min(low, out);
      high = Math.max(high, out);
    }
    expect(high - low).toBeLessThan(0.004);
    expect((high + low) / 2).toBeCloseTo(0.5, 2);
  });

  it("keeps up with a fast sweep", () => {
    // 0 to 1 in half a second: at the end the output is within 5% of the hand.
    const filter = oneEuro();
    let out = 0;
    for (let i = 0; i <= 30; i++) out = filter(i / 30, i / 60);
    expect(out).toBeGreaterThan(0.95);
  });
});

describe("createPointer", () => {
  it("turns aims into clamped, smoothed points and corrects drift at the edges", () => {
    const pointer = createPointer(defaultCalibration(aimOf(sample(100, 0))));
    expect(pointer.update(aimOf(sample(100, 0)), 0)).toEqual({ x: 0.5, y: 0.5 });
    // Holding 35° to the left: the point stays on the screen, and the calibration followed.
    let point = { x: 0, y: 0 };
    for (let i = 1; i <= 60; i++) point = pointer.update(aimOf(sample(135, 0)), i / 60);
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThan(0.02);
    expect(deg(wrap(pointer.calibration.yaw - rad(100)))).toBeCloseTo(15);
    // Re-centring answers at once: no history is carried over.
    pointer.recentre(aimOf(sample(135, 0)));
    expect(pointer.update(aimOf(sample(135, 0)), 2)).toEqual({ x: 0.5, y: 0.5 });
  });
});
