type Vec = readonly [number, number, number];

export interface D20Face {
  readonly value: number;
  readonly placement: string;
  readonly rest: string;
}

export const D20_INRADIUS_PER_EDGE = 0.75576;

const PHI = (1 + Math.sqrt(5)) / 2;
const EDGE = 2;

const VERTICES: readonly Vec[] = [-1, 1].flatMap((a) =>
  [-1, 1].flatMap((b): Vec[] => [
    [0, a, b * PHI],
    [a, b * PHI, 0],
    [a * PHI, 0, b],
  ]),
);

function sub(p: Vec, q: Vec): Vec {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}

function add(p: Vec, q: Vec): Vec {
  return [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
}

function scale(p: Vec, k: number): Vec {
  return [p[0] * k, p[1] * k, p[2] * k];
}

function dot(p: Vec, q: Vec): number {
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
}

function cross(p: Vec, q: Vec): Vec {
  return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
}

function length(p: Vec): number {
  return Math.sqrt(dot(p, p));
}

function unit(p: Vec): Vec {
  return scale(p, 1 / length(p));
}

function adjacent(p: Vec, q: Vec): boolean {
  return Math.abs(length(sub(p, q)) - EDGE) < 1e-9;
}

interface Triangle {
  readonly corners: readonly [Vec, Vec, Vec];
  readonly centroid: Vec;
}

function triangles(): readonly Triangle[] {
  const found: Triangle[] = [];
  for (let i = 0; i < VERTICES.length; i += 1) {
    for (let j = i + 1; j < VERTICES.length; j += 1) {
      for (let k = j + 1; k < VERTICES.length; k += 1) {
        const a = VERTICES[i] as Vec;
        const b = VERTICES[j] as Vec;
        const c = VERTICES[k] as Vec;
        if (adjacent(a, b) && adjacent(b, c) && adjacent(a, c)) {
          found.push({ corners: [a, b, c], centroid: scale(add(add(a, b), c), 1 / 3) });
        }
      }
    }
  }
  return found;
}

function byCentroid(p: Triangle, q: Triangle): number {
  for (let axis = 0; axis < 3; axis += 1) {
    const d = (p.centroid[axis] as number) - (q.centroid[axis] as number);
    if (Math.abs(d) > 1e-9) return d;
  }
  return 0;
}

function opposite(p: Triangle, q: Triangle): boolean {
  return length(add(p.centroid, q.centroid)) < 1e-9;
}

function numbered(all: readonly Triangle[]): readonly (readonly [Triangle, number])[] {
  const sorted = [...all].sort(byCentroid);
  const values = new Map<Triangle, number>();
  let next = 1;
  for (const face of sorted) {
    if (values.has(face)) continue;
    const twin = sorted.find((other) => opposite(face, other));
    if (twin === undefined) throw new Error('d20: a face with no opposite is not an icosahedron');
    values.set(face, next);
    values.set(twin, 21 - next);
    next += 1;
  }
  return sorted.map((face) => [face, values.get(face) as number]);
}

function fixed(n: number): string {
  const rounded = Number(n.toFixed(5));
  return String(rounded === 0 ? 0 : rounded);
}

function matrix(columns: readonly [Vec, Vec, Vec]): string {
  const cells = columns.flatMap((column) => [...column.map(fixed), '0']);
  return `matrix3d(${[...cells, '0', '0', '0', '1'].join(',')})`;
}

function frame(face: Triangle): readonly [Vec, Vec, Vec] {
  const normal = unit(face.centroid);
  const apex = unit(sub(face.corners[0], face.centroid));
  const down = scale(apex, -1);
  const right = cross(down, normal);
  return [right, down, normal];
}

function faceOf(face: Triangle, value: number): D20Face {
  const [right, down, normal] = frame(face);
  const transposed: readonly [Vec, Vec, Vec] = [
    [right[0], down[0], normal[0]],
    [right[1], down[1], normal[1]],
    [right[2], down[2], normal[2]],
  ];
  return {
    value,
    placement: `${matrix([right, down, normal])} translateZ(calc(var(--mtg-d20-edge) * ${String(D20_INRADIUS_PER_EDGE)}))`,
    rest: matrix(transposed),
  };
}

export const D20_FACE_LIST: readonly D20Face[] = numbered(triangles()).map(([face, value]) =>
  faceOf(face, value),
);

export function d20Face(value: number): D20Face {
  const face = D20_FACE_LIST.find((candidate) => candidate.value === value);
  if (face === undefined) throw new Error(`d20: no face reads ${String(value)}`);
  return face;
}

export const D20_GEOMETRY = { edge: EDGE, triangles };
