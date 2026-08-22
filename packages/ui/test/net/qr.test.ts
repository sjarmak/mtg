/**
 * The terminal QR code, checked by reading it back.
 *
 * `tools/qr.ts` exists because no QR encoder is installed here and `AGENTS.md`
 * treats a new dependency as a reportable finding. An encoder nobody can decode
 * is a picture, though, so this file is a small independent decoder: it finds
 * the function modules from the specification's own rules rather than from the
 * encoder's, reads the format information, removes the mask, walks the zigzag,
 * checks the Reed-Solomon remainder is zero and recovers the string.
 *
 * That is not a substitute for pointing a phone at it, which no test in this
 * checkout can do. It is the part that can be checked here, and it catches every
 * bug that leaves a self-consistent grid saying the wrong thing.
 */
import { describe, expect, it } from 'vitest';
import { encodeQr, errorCorrection, MAX_PAYLOAD_BYTES, renderQr } from '../../tools/qr';
import type { QrMatrix } from '../../tools/qr';

/** Error-correction codewords per block at level L, versions 1 through 5. */
const EC_CODEWORDS: readonly number[] = [7, 10, 15, 20, 26];

/**
 * Which modules are patterns rather than payload.
 *
 * Written out from the specification here, deliberately not shared with the
 * encoder: a decoder that borrowed the encoder's map would agree with it about
 * a mistake.
 */
function functionMap(size: number, version: number): boolean[][] {
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, column: number): void => {
    if (row < 0 || column < 0 || row >= size || column >= size) return;
    (map[row] as boolean[])[column] = true;
  };
  for (const [row, column] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr += 1) for (let dc = -1; dc <= 7; dc += 1) mark(row + dr, column + dc);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  if (version >= 2) {
    const center = size - 7;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(center + dr, center + dc);
  }
  for (let i = 0; i < size; i += 1) {
    if (i <= 8 || i >= size - 8) {
      mark(8, i);
      mark(i, 8);
    }
  }
  return map;
}

function maskCondition(mask: number, row: number, column: number): boolean {
  if (mask === 0) return (row + column) % 2 === 0;
  if (mask === 1) return row % 2 === 0;
  if (mask === 2) return column % 3 === 0;
  if (mask === 3) return (row + column) % 3 === 0;
  if (mask === 4) return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
  if (mask === 5) return ((row * column) % 2) + ((row * column) % 3) === 0;
  if (mask === 6) return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
  return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
}

interface Decoded {
  readonly version: number;
  readonly mask: number;
  readonly ecLevel: number;
  readonly text: string;
  readonly remainder: readonly number[];
}

function decode(matrix: QrMatrix): Decoded {
  const { size } = matrix;
  const version = (size - 17) / 4;
  const dark = (row: number, column: number): boolean => matrix.modules[row]?.[column] === true;

  // The first copy of the format information, in the order the standard names.
  const positions: readonly (readonly [number, number])[] = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ];
  let raw = 0;
  positions.forEach(([row, column], index) => {
    if (dark(row, column)) raw |= 1 << index;
  });
  // The five data bits sit above the ten BCH bits: level in 14..13, mask in 12..10.
  const bits = raw ^ 0x5412;
  const mask = (bits >> 10) & 0b111;
  const ecLevel = (bits >> 13) & 0b11;

  const map = functionMap(size, version);
  const unmasked = matrix.modules.map((row, r) =>
    row.map((module, c) => (map[r]?.[c] === true ? module : module !== maskCondition(mask, r, c))),
  );

  const stream: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if (map[row]?.[column] === true) continue;
        stream.push(unmasked[row]?.[column] === true ? 1 : 0);
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= stream.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (stream[i + j] ?? 0);
    codewords.push(byte);
  }

  const degree = EC_CODEWORDS[version - 1] ?? 0;
  const remainder = errorCorrection(codewords, degree);

  let cursor = 0;
  const take = (width: number): number => {
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      value = (value << 1) | (stream[cursor] ?? 0);
      cursor += 1;
    }
    return value;
  };
  const mode = take(4);
  expect(mode).toBe(0b0100);
  const length = take(8);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = take(8);
  return { version, mask, ecLevel, text: new TextDecoder().decode(bytes), remainder };
}

const KAELEN = 'http://192.168.1.42:5273/#/play?table=3f2a6c1e-8b4d-4c7a-9e10-5d6b2f8a1c33';

describe('the terminal QR code', () => {
  it('draws a code that decodes back to the link it was given', () => {
    const matrix = encodeQr(KAELEN);
    expect(matrix).toBeDefined();
    const decoded = decode(matrix as QrMatrix);
    expect(decoded.text).toBe(KAELEN);
    // Error-correction level L is the two bits `01`.
    expect(decoded.ecLevel).toBe(0b01);
    expect(decoded.remainder.every((byte) => byte === 0)).toBe(true);
  });

  it('decodes every length up to the versions it supports, at whatever mask it chose', () => {
    const masks = new Set<number>();
    for (const length of [1, 17, 18, 19, 32, 53, 54, 78, 79, MAX_PAYLOAD_BYTES]) {
      const text = 'x'.repeat(length);
      const matrix = encodeQr(text);
      expect(matrix, `length ${String(length)} should encode`).toBeDefined();
      const decoded = decode(matrix as QrMatrix);
      expect(decoded.text, `length ${String(length)}`).toBe(text);
      expect(
        decoded.remainder.every((byte) => byte === 0),
        `length ${String(length)}`,
      ).toBe(true);
      masks.add(decoded.mask);
    }
    // A single mask across every input would mean the penalty scoring is inert.
    expect(masks.size).toBeGreaterThan(1);
  });

  it('carries non-ASCII text as the bytes it encodes to', () => {
    const text = 'seat two: café';
    const matrix = encodeQr(text);
    expect(decode(matrix as QrMatrix).text).toBe(text);
  });

  it('picks the smallest version that holds the payload', () => {
    expect(decode(encodeQr('x'.repeat(17)) as QrMatrix).version).toBe(1);
    expect(decode(encodeQr('x'.repeat(18)) as QrMatrix).version).toBe(2);
    expect(decode(encodeQr('x'.repeat(32)) as QrMatrix).version).toBe(2);
    expect(decode(encodeQr('x'.repeat(33)) as QrMatrix).version).toBe(3);
  });

  it('refuses a payload no supported version holds, rather than truncating it', () => {
    expect(encodeQr('x'.repeat(MAX_PAYLOAD_BYTES + 1))).toBeUndefined();
  });

  it('renders one text row per two module rows, with the quiet zone', () => {
    const matrix = encodeQr(KAELEN) as QrMatrix;
    const lines = renderQr(matrix);
    expect(lines).toHaveLength(Math.ceil((matrix.size + 8) / 2));
    // Every line resets the terminal's colors, or the rest of the session is white.
    expect(lines.every((line) => line.endsWith('\u001b[0m'))).toBe(true);
  });
});
