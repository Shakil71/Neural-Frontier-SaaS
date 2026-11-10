import { describe, expect, it } from "vitest";
import {
  addEccAndInterleave,
  dataCodewords,
  encodeData,
  encodeQr,
  formatBits,
  rsRemainder,
  versionBits,
} from "./qr";

describe("QR encoder building blocks (values from ISO/IEC 18004 and its worked examples)", () => {
  it("level M data capacity per version", () => {
    expect([1, 2, 5, 7, 10, 40].map(dataCodewords)).toEqual([16, 28, 86, 124, 216, 2334]);
  });

  it("Reed–Solomon error correction of the 1-M 'HELLO WORLD' example", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("format information for level M, masks 0–7, and level L mask 0", () => {
    const m = [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ];
    m.forEach((bits, mask) => expect(formatBits(mask).toString(2).padStart(15, "0")).toBe(bits));
    expect(formatBits(0, 1).toString(2).padStart(15, "0")).toBe("111011111000100");
  });

  it("version information (BCH 18,6)", () => {
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(versionBits(40).toString(2).padStart(18, "0")).toBe("101000110001101001");
  });

  it("byte-mode data: header, payload, terminator and alternating pad bytes", () => {
    const out = encodeData(new TextEncoder().encode("hi"), 1);
    expect(out).toHaveLength(16);
    // 0100 | 00000010 | 01101000 01101001 | 0000 → 0x40 0x26 0x86 0x90, then 0xEC 0x11 …
    expect(out.slice(0, 6)).toEqual([0x40, 0x26, 0x86, 0x90, 0xec, 0x11]);
  });

  it("interleaving keeps every codeword exactly once", () => {
    const data = Array.from({ length: dataCodewords(5) }, (_, i) => i);
    const all = addEccAndInterleave(data, 5);
    expect(all).toHaveLength(134);
    // Data codewords come first, alternating between the two blocks.
    expect(all.slice(0, 4)).toEqual([0, 43, 1, 44]);
  });
});

describe("encodeQr", () => {
  const uri =
    "otpauth://totp/Neural%20Frontier:ana%40acme.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Neural%20Frontier&algorithm=SHA1&digits=6&period=30";

  it("picks the smallest version that fits and draws the fixed patterns", () => {
    const qr = encodeQr(uri);
    expect(qr.size).toBe(qr.version * 4 + 17);
    expect(qr.version).toBe(8);
    const m = qr.modules;
    // Finder patterns: dark outer ring, light ring, dark 3×3 core, light separator.
    for (const [x, y] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ] as const) {
      expect(m[y]![x]).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
      expect(m[y + 3]![x + 3]).toBe(true);
    }
    expect(m[7]![7]).toBe(false);
    // Timing pattern alternates; the dark module is always dark.
    expect(m[6]!.slice(8, qr.size - 8)).toEqual(
      Array.from({ length: qr.size - 16 }, (_, i) => i % 2 === 0),
    );
    expect(m[qr.size - 8]![8]).toBe(true);
  });

  it("is deterministic and chooses a valid mask", () => {
    const a = encodeQr(uri);
    const b = encodeQr(uri);
    expect(a.modules).toEqual(b.modules);
    expect(a.mask).toBeGreaterThanOrEqual(0);
    expect(a.mask).toBeLessThan(8);
  });

  it("refuses text beyond version 40", () => {
    expect(() => encodeQr("x".repeat(3000))).toThrow(/too long/);
  });
});
