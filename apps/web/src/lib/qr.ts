/**
 * QR code encoder (ISO/IEC 18004), written in-house for authenticator set-up links.
 * Byte mode, error-correction level M (≈15% damage tolerated), versions 1–40, best mask chosen
 * by the standard's penalty rules. Returns the module matrix; rendering is up to the caller.
 */

// Level M rows of the standard's capacity tables, indexed by version (index 0 unused).
const ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
/** Level M's 2-bit indicator in the format information. */
const FORMAT_BITS_M = 0;

export function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver]! * BLOCKS_M[ver]!;
}

// ---------- Reed–Solomon over GF(2^8), polynomial 0x11D ----------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: readonly number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

// ---------- Format and version information (BCH codes) ----------

export function formatBits(mask: number, ecl = FORMAT_BITS_M): number {
  const data = (ecl << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

// ---------- Encoding ----------

/** Data codewords for `bytes` in byte mode, padded to the version's capacity. */
export function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  for (let pad = 0xec; out.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits into blocks, appends each block's error correction, and interleaves. */
export function addEccAndInterleave(data: readonly number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver]!;
  const eccLen = ECC_PER_BLOCK_M[ver]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, eccLen);
    if (i < numShort) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(block[i]!);
    });
  }
  return out;
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Penalty score from the standard (N1–N4): lower reads more reliably. */
export function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]!);
    lines.push(m.map((row) => row[i]!));
  }
  for (const line of lines) {
    // N1: runs of five or more same-colour modules.
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // N3: finder-like 1:1:3:1:1 with four light modules on one side.
    const s = line.map((d) => (d ? "1" : "0")).join("");
    for (const pattern of ["10111010000", "00001011101"]) {
      for (let at = s.indexOf(pattern); at !== -1; at = s.indexOf(pattern, at + 1)) score += 40;
    }
  }
  // N2: 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
    }
  }
  // N4: balance of dark and light.
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

export interface QrCode {
  version: number;
  mask: number;
  size: number;
  /** modules[y][x]: true = dark. */
  modules: boolean[][];
}

export function encodeQr(text: string, opts: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (
    version <= 40 &&
    4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  ) {
    version++;
  }
  if (version > 40) throw new Error("Text is too long for a QR code");
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    fixed[y]![x] = true;
  };

  // Timing patterns, then finders (with separators) over them.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(version, size);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true); // the dark module
  };
  drawFormat(0); // reserve the format areas before placing data
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  // Codewords in the zig-zag order, two columns at a time, skipping the vertical timing column.
  const codewords = addEccAndInterleave(encodeData(bytes, version), version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y]![x] && MASKS[mask]!(x, y)) modules[y]![x] = !modules[y]![x];
      }
    }
  };
  let best = opts.mask ?? -1;
  if (best < 0) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      const score = penalty(modules);
      if (score < bestScore) {
        best = mask;
        bestScore = score;
      }
      applyMask(mask); // XOR again undoes it
    }
  }
  applyMask(best);
  drawFormat(best);
  return { version, mask: best, size, modules };
}
