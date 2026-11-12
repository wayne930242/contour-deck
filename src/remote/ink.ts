/** Freehand strokes on a canvas, kept in normalised coordinates so a resize redraws them in place. */

export interface Ink {
  /** Adds points (`[x, y, x, y, …]` in [0, 1]) to the stroke named `key`, starting it when new. */
  add(key: string, points: number[]): void;
  clear(): void;
  /** Call when the canvas element changed size. */
  resize(): void;
  /** Number of strokes on the canvas. */
  readonly count: number;
}

/** Above this many points the oldest strokes go, so a guest cannot grow the page without bound. */
const MAX_POINTS = 20_000;

export function createInk(canvas: HTMLCanvasElement): Ink {
  const strokes = new Map<string, number[]>();
  const context = canvas.getContext("2d");
  let total = 0;
  let frame = 0;

  function draw() {
    frame = 0;
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = context.fillStyle = getComputedStyle(canvas).color;
    context.lineWidth = Math.max(2, Math.min(width, height) * 0.006);
    context.lineCap = context.lineJoin = "round";
    for (const points of strokes.values()) {
      context.beginPath();
      if (points.length === 2) {
        context.arc(points[0] * width, points[1] * height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.moveTo(points[0] * width, points[1] * height);
      // Through the midpoints, with each sample as a control point: corners of the sampling turn into curves.
      for (let i = 2; i < points.length - 2; i += 2) {
        const [x, y, nextX, nextY] = [points[i] * width, points[i + 1] * height, points[i + 2] * width, points[i + 3] * height];
        context.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
      }
      context.lineTo(points.at(-2)! * width, points.at(-1)! * height);
      context.stroke();
    }
  }
  const schedule = () => void (frame ||= requestAnimationFrame(draw));

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    cancelAnimationFrame(frame);
    draw();
  }
  resize();

  return {
    add(key, points) {
      const stroke = strokes.get(key);
      if (stroke) stroke.push(...points);
      else strokes.set(key, [...points]);
      total += points.length / 2;
      for (const [oldest, old] of strokes) {
        if (total <= MAX_POINTS || oldest === key) break;
        strokes.delete(oldest);
        total -= old.length / 2;
      }
      schedule();
    },
    clear() {
      strokes.clear();
      total = 0;
      schedule();
    },
    resize,
    get count() {
      return strokes.size;
    },
  };
}
