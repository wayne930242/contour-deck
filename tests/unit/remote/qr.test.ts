/** The built-in QR encoder, read back by an independent decoder (jsQR). */
import jsqr from "jsqr";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvg } from "../../../src/remote/qr.js";

// jsqr is CommonJS with a `default` export: the test runner unwraps it, the type checker does not.
type Decode = typeof jsqr.default;
const jsQR = ((jsqr as { default?: Decode }).default ?? jsqr) as Decode;

/** Paints the modules as pixels, `scale` per module with a 4-module quiet zone, and decodes the picture. */
function read(modules: boolean[][], scale = 4): string | null {
  const side = (modules.length + 8) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    })
  );
  return jsQR(pixels, side, side)?.data ?? null;
}

const ROOM = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";

describe("qrMatrix", () => {
  it("encodes a pairing link that a decoder reads back", () => {
    const link = `https://www.example.com/posts/outline-first-slides/?view=remote&room=${ROOM}`;
    const modules = qrMatrix(link)!;
    expect(modules.length).toBe(17 + 4 * 6); // 91 bytes need version 6 at level M
    expect(read(modules)).toBe(link);
  });

  it("round-trips every version from 1 to 12, at both ends of its capacity", () => {
    // Bytes that fit each version at level M in byte mode.
    const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287];
    capacity.forEach((bytes, i) => {
      for (const length of [i ? capacity[i - 1] + 1 : 1, bytes]) {
        const text = Array.from({ length }, (_, k) => "abcdefghijklmnopqrstuvwxyz0123456789?=&/:."[(k * 7 + i) % 42]).join("");
        const modules = qrMatrix(text)!;
        expect(modules.length, `version of ${length} bytes`).toBe(17 + 4 * (i + 1));
        expect(read(modules), `${length} bytes`).toBe(text);
      }
    });
  });

  it("counts UTF-8 bytes, not characters", () => {
    const text = "https://例子.tw/簡報?view=notes";
    expect(read(qrMatrix(text)!)).toBe(text);
  });

  it("returns null for a text that does not fit version 12", () => {
    expect(qrMatrix("x".repeat(288))).toBeNull();
    expect(qrSvg("x".repeat(288))).toBeNull();
  });
});

describe("qrSvg", () => {
  it("draws dark runs on a white square with a quiet zone of 4 modules", () => {
    const svg = qrSvg("contour")!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 29 29"/);
    expect(svg).toContain('<path fill="#fff" d="M0 0h29v29H0z"/>');
    // The top-left finder pattern starts with a run of 7 dark modules at the quiet-zone offset.
    expect(svg).toContain("M4 4h7v1h-7z");
  });
});
