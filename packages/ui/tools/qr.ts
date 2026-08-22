/**
 * A QR code, drawn in the terminal, so seat two's link reaches seat two.
 *
 * Both seat links print to the host's stdout. Getting the second one onto the
 * second device is otherwise an out-of-band problem the launcher does not help
 * with: read 36 hexadecimal digits of a UUID aloud, or find a chat window that
 * both machines are already signed into, which is a strange thing to need
 * before a game on your own sofa.
 *
 * # Why this is written here rather than installed
 *
 * `AGENTS.md` treats a new third-party dependency as a reportable finding, and
 * `@mtg/netplay` was deliberately written against `node:http` with neither `ws`
 * nor `express` for exactly that reason. No QR encoder is present in this
 * workspace. So this file is the encoder, and it is small because it refuses
 * almost everything: **byte mode, error-correction level L, versions 1 through
 * 5**. Those versions all carry a single Reed-Solomon block and a single
 * alignment pattern, which is where most of the length of a general encoder
 * goes. Version 5-L holds 106 bytes; the link it has to carry is a dotted-quad
 * URL and a UUID, about sixty. Anything longer is refused by name rather than
 * silently truncated, and the caller prints the link alone.
 *
 * # Why the modules are colored rather than drawn
 *
 * A scanner wants dark modules on a light field. Spelling light modules with
 * block characters and dark ones with spaces is the usual terminal trick and it
 * inverts on a light-themed terminal, which is a code that does not scan and
 * says nothing about why. So each module states its own color, and the field is
 * white whatever the terminal's is. One character carries two module rows
 * through the upper-half block, because a terminal cell is about twice as tall
 * as it is wide and two rows in one cell is therefore roughly square.
 */

/** Data codewords available at error-correction level L, versions 1 through 5. */
const DATA_CODEWORDS: readonly number[] = [19, 34, 55, 80, 108];

/** Error-correction codewords per block at level L, versions 1 through 5. */
const EC_CODEWORDS: readonly number[] = [7, 10, 15, 20, 26];

/** The largest byte payload any supported version can carry (mode and length cost two bytes). */
export const MAX_PAYLOAD_BYTES = 106;

/** A finished code: a square grid of dark and light modules. */
export interface QrMatrix {
  readonly size: number;
  /** `true` is a dark module. Indexed `[row][column]`. */
  readonly modules: readonly (readonly boolean[])[];
}

// --- GF(256), the field the error correction is computed in -----------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[(GF_LOG[left] ?? 0) + (GF_LOG[right] ?? 0)] ?? 0;
}

/** The generator polynomial whose roots are the first `degree` powers of two. */
function generatorPolynomial(degree: number): readonly number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      const coefficient = poly[j] ?? 0;
      // Descending order: index 0 is the leading term, so multiplying by `x` is
      // the identity on the index and the constant factor moves one place down.
      next[j] = (next[j] ?? 0) ^ coefficient;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMultiply(coefficient, GF_EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` remainder codewords that follow `data` on the wire. */
export function errorCorrection(data: readonly number[], degree: number): readonly number[] {
  const generator = generatorPolynomial(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) {
      remainder[i] = (remainder[i] ?? 0) ^ gfMultiply(generator[i + 1] ?? 0, factor);
    }
  }
  return remainder;
}

// --- The bit stream ---------------------------------------------------------

/** The smallest supported version that holds `byteLength` bytes, or `undefined`. */
function versionFor(byteLength: number): number | undefined {
  for (let version = 1; version <= 5; version += 1) {
    // Mode indicator (4 bits) plus an 8-bit character count is two whole bytes.
    if (byteLength + 2 <= (DATA_CODEWORDS[version - 1] ?? 0)) return version;
  }
  return undefined;
}

function codewordsFor(bytes: readonly number[], version: number): readonly number[] {
  const capacity = DATA_CODEWORDS[version - 1] ?? 0;
  const bits: number[] = [];
  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  const terminator = Math.min(4, capacity * 8 - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }
  // The two pad codewords the specification names, alternating, to capacity.
  for (let i = 0; codewords.length < capacity; i += 1) codewords.push(i % 2 === 0 ? 0xec : 0x11);
  return codewords;
}

// --- The grid ---------------------------------------------------------------

interface Grid {
  readonly size: number;
  readonly modules: boolean[][];
  /** A function module is a pattern, not payload, and no mask ever touches it. */
  readonly reserved: boolean[][];
}

function blankGrid(size: number): Grid {
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules, reserved };
}

function setFunction(grid: Grid, row: number, column: number, dark: boolean): void {
  if (row < 0 || column < 0 || row >= grid.size || column >= grid.size) return;
  (grid.modules[row] as boolean[])[column] = dark;
  (grid.reserved[row] as boolean[])[column] = true;
}

function drawFinder(grid: Grid, row: number, column: number): void {
  // The 7x7 pattern plus the one-module separator around it, clipped at the edge.
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const distance = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      setFunction(grid, row + dr, column + dc, distance !== 2 && distance <= 3);
    }
  }
}

function drawPatterns(grid: Grid, version: number): void {
  const { size } = grid;
  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, size - 7);
  drawFinder(grid, size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  if (version >= 2) {
    // Versions 2 through 6 carry exactly one alignment pattern, bottom right.
    const center = size - 7;
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const distance = Math.max(Math.abs(dr), Math.abs(dc));
        setFunction(grid, center + dr, center + dc, distance !== 1);
      }
    }
  }
  // The always-dark module, and the format areas, reserved before any payload.
  setFunction(grid, size - 8, 8, true);
  for (let i = 0; i <= 8; i += 1) {
    setFunction(grid, 8, i, false);
    setFunction(grid, i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) setFunction(grid, 8, size - 1 - i, false);
  for (let i = 8; i < 15; i += 1) setFunction(grid, size - 15 + i, 8, false);
}

function drawFormat(grid: Grid, mask: number): void {
  const data = (0b01 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number): boolean => ((bits >>> index) & 1) === 1;
  const { size } = grid;
  for (let i = 0; i <= 5; i += 1) setFunction(grid, i, 8, bit(i));
  setFunction(grid, 7, 8, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(grid, 8, 14 - i, bit(i));
  for (let i = 0; i < 8; i += 1) setFunction(grid, 8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(grid, size - 15 + i, 8, bit(i));
  setFunction(grid, size - 8, 8, true);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const { size } = grid;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern. The pair steps left past it, and
    // the step is permanent: the columns below it are 5 and 4, then 3 and 2.
    if (right === 6) right = 5;
    const column = right;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const c = column - offset;
        const upward = ((column + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if ((grid.reserved[row] as boolean[])[c] === true) continue;
        if (index >= codewords.length * 8) continue;
        const byte = codewords[index >>> 3] ?? 0;
        (grid.modules[row] as boolean[])[c] = ((byte >>> (7 - (index & 7))) & 1) === 1;
        index += 1;
      }
    }
  }
}

/** The eight mask conditions, in the order the format bits number them. */
export function maskCondition(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    case 7:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      throw new Error(`mask ${String(mask)} is not one of the eight`);
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let row = 0; row < grid.size; row += 1) {
    for (let column = 0; column < grid.size; column += 1) {
      if ((grid.reserved[row] as boolean[])[column] === true) continue;
      if (!maskCondition(mask, row, column)) continue;
      const current = (grid.modules[row] as boolean[])[column] === true;
      (grid.modules[row] as boolean[])[column] = !current;
    }
  }
}

function runPenalty(line: readonly boolean[]): number {
  let score = 0;
  let run = 1;
  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === line[i - 1]) {
      run += 1;
      if (run === 5) score += 3;
      else if (run > 5) score += 1;
    } else run = 1;
  }
  return score;
}

const FINDER_RUN: readonly boolean[] = [true, false, true, true, true, false, true];

function finderPenalty(line: readonly boolean[]): number {
  let score = 0;
  for (let i = 0; i + 7 <= line.length; i += 1) {
    let matches = true;
    for (let j = 0; j < 7; j += 1) {
      if (line[i + j] !== FINDER_RUN[j]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const before = line.slice(Math.max(0, i - 4), i);
    const after = line.slice(i + 7, i + 11);
    const clear = (part: readonly boolean[]): boolean => part.length === 4 && part.every((module) => !module);
    if (clear(before) || clear(after)) score += 40;
  }
  return score;
}

function penalty(grid: Grid): number {
  const { size, modules } = grid;
  let score = 0;
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    const line = modules[row] as boolean[];
    score += runPenalty(line) + finderPenalty(line);
    dark += line.filter((module) => module).length;
  }
  for (let column = 0; column < size; column += 1) {
    const line = modules.map((row) => row[column] === true);
    score += runPenalty(line) + finderPenalty(line);
  }
  for (let row = 0; row + 1 < size; row += 1) {
    for (let column = 0; column + 1 < size; column += 1) {
      const first = (modules[row] as boolean[])[column];
      if (
        first === (modules[row] as boolean[])[column + 1] &&
        first === (modules[row + 1] as boolean[])[column] &&
        first === (modules[row + 1] as boolean[])[column + 1]
      ) {
        score += 3;
      }
    }
  }
  const proportion = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(proportion - 50) / 5) * 10;
  return score;
}

/**
 * Encode a string as a QR matrix, or refuse it.
 *
 * Refusal is a returned `undefined` rather than a throw: the caller's answer to
 * a link too long to draw is to print the link on its own, which is what it
 * would have done anyway, not to fail the launcher.
 */
export function encodeQr(text: string): QrMatrix | undefined {
  const bytes = [...new TextEncoder().encode(text)];
  const version = versionFor(bytes.length);
  if (version === undefined) return undefined;
  const data = codewordsFor(bytes, version);
  const codewords = [...data, ...errorCorrection([...data], EC_CODEWORDS[version - 1] ?? 0)];

  let best: Grid | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = blankGrid(17 + 4 * version);
    drawPatterns(grid, version);
    drawCodewords(grid, codewords);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  if (best === undefined) return undefined;
  return { size: best.size, modules: best.modules.map((row) => [...row]) };
}

const QUIET_ZONE = 4;
const WHITE_ON_BLACK = '\u001b[97;40m';
const BLACK_ON_WHITE = '\u001b[30;107m';
const WHITE_ON_WHITE = '\u001b[97;107m';
const BLACK_ON_BLACK = '\u001b[30;40m';
const RESET = '\u001b[0m';
const UPPER_HALF = '▀';

/**
 * The matrix as terminal lines, quiet zone included.
 *
 * Each character carries the module above it as its foreground and the module
 * below it as its background, so two module rows cost one text row and the
 * result is about square in a terminal cell. The quiet zone is four modules,
 * which the specification requires and which a scanner pointed at a wall of
 * scrollback genuinely needs.
 */
export function renderQr(matrix: QrMatrix): readonly string[] {
  const span = matrix.size + QUIET_ZONE * 2;
  const dark = (row: number, column: number): boolean => {
    const r = row - QUIET_ZONE;
    const c = column - QUIET_ZONE;
    if (r < 0 || c < 0 || r >= matrix.size || c >= matrix.size) return false;
    return matrix.modules[r]?.[c] === true;
  };
  const lines: string[] = [];
  for (let row = 0; row < span; row += 2) {
    let line = '';
    for (let column = 0; column < span; column += 1) {
      const top = dark(row, column);
      const bottom = dark(row + 1, column);
      if (top && bottom) line += `${BLACK_ON_BLACK}${UPPER_HALF}`;
      else if (top) line += `${BLACK_ON_WHITE}${UPPER_HALF}`;
      else if (bottom) line += `${WHITE_ON_BLACK}${UPPER_HALF}`;
      else line += `${WHITE_ON_WHITE}${UPPER_HALF}`;
    }
    lines.push(`${line}${RESET}`);
  }
  return lines;
}
