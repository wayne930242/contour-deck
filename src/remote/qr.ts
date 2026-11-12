/**
 * A small QR encoder for the pairing links: byte mode, error correction M, versions 1 to 12
 * (up to 287 bytes of UTF-8). A host that already ships a QR library passes its own through the `qr` option.
 */

/** Error-correction codewords per block and the number of blocks at level M, for versions 1 to 12. */
const BLOCKS = [[10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5], [30, 5], [22, 8]];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Reed-Solomon remainder of `data` for `degree` error-correction codewords. */
function errorCorrection(data: number[], degree: number): number[] {
  const divisor = new Array<number>(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = gfMul(divisor[j], root);
      if (j + 1 < degree) divisor[j] ^= divisor[j + 1];
    }
    root = gfMul(root, 2);
  }
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i] ^= gfMul(coefficient, factor)));
  }
  return result;
}

/** Codewords a version holds in all, data and error correction. */
function rawCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules >> 3;
}

function alignmentCentres(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centres = [6];
  for (let at = size - 7; centres.length < count; at -= step) centres.splice(1, 0, at);
  return centres;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The penalty score of the standard: long runs, 2×2 blocks, finder look-alikes, and dark balance. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  let dark = 0;
  const lines: string[] = [];
  for (let i = 0; i < size; i++) {
    let row = "";
    let column = "";
    for (let j = 0; j < size; j++) {
      row += modules[i][j] ? 1 : 0;
      column += modules[j][i] ? 1 : 0;
      if (modules[i][j]) dark++;
      if (i && j && modules[i][j] === modules[i - 1][j] && modules[i][j] === modules[i][j - 1] && modules[i][j] === modules[i - 1][j - 1]) score += 3;
    }
    lines.push(row, column);
  }
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) ?? []) score += run.length - 2;
    for (let at = 0; at <= size - 11; at++) {
      const window = line.substr(at, 11);
      if (window === "10111010000" || window === "00001011101") score += 40;
    }
  }
  return score + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
}

/** The modules of the QR code of `text` (`true` is dark), `[row][column]`, or `null` when it does not fit. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  let dataLength = 0;
  for (let v = 1; v <= BLOCKS.length && !version; v++) {
    const [ecLength, blocks] = BLOCKS[v - 1];
    dataLength = rawCodewords(v) - ecLength * blocks;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataLength * 8) version = v;
  }
  if (!version) return null;
  const [ecLength, blockCount] = BLOCKS[version - 1];
  const size = version * 4 + 17;

  /* ---- data codewords: mode, length, bytes, terminator, padding ---- */
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(4, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, dataLength * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataLength * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  /* ---- blocks with error correction, interleaved ---- */
  const shortBlocks = blockCount - (rawCodewords(version) % blockCount);
  const shortLength = Math.floor(rawCodewords(version) / blockCount) - ecLength;
  const blocks: { data: number[]; ec: number[] }[] = [];
  for (let i = 0, at = 0; i < blockCount; i++) {
    const part = data.slice(at, (at += shortLength + (i < shortBlocks ? 0 : 1)));
    blocks.push({ data: part, ec: errorCorrection(part, ecLength) });
  }
  const codewords: number[] = [];
  for (let i = 0; i <= shortLength; i++) for (const block of blocks) if (i < block.data.length) codewords.push(block.data[i]);
  for (let i = 0; i < ecLength; i++) for (const block of blocks) codewords.push(block.ec[i]);

  /* ---- function patterns ---- */
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, ring !== 2 && ring !== 4);
      }
    }
  }
  const centres = alignmentCentres(version, size);
  centres.forEach((cy, i) =>
    centres.forEach((cx, j) => {
      // The three corners with a finder pattern have no alignment pattern.
      if ((i === 0 && j === 0) || (i === 0 && j === centres.length - 1) || (i === centres.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    })
  );
  const format = (mask: number) => {
    // Level M is 00, so the five data bits are the mask alone.
    let remainder = mask;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const word = ((mask << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((word >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const word = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((word >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  /* ---- data in the zigzag, then the mask with the lowest penalty ---- */
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (reserved[y][x] || index >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
        index++;
      }
    }
  }
  const flip = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask);
    format(mask);
    const score = penalty(modules);
    if (score < lowest) [best, lowest] = [mask, score];
    flip(mask);
  }
  flip(best);
  format(best);
  return modules;
}

/** Quiet zone around the code, in modules. */
const QUIET = 4;

/** The QR code of `text` as an SVG string, dark on white whatever the theme; `null` when the text is too long. */
export function qrSvg(text: string): string | null {
  const modules = qrMatrix(text);
  if (!modules) return null;
  const side = modules.length + QUIET * 2;
  let path = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${side}v${side}H0z"/><path d="${path}"/></svg>`;
}
