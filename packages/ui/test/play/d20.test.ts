import { describe, expect, it } from 'vitest';
import { D20_FACE_LIST, D20_GEOMETRY, D20_INRADIUS_PER_EDGE, d20Face } from '../../src/routes/play/d20';

function cells(transform: string): number[] {
  const match = /matrix3d\(([^)]*)\)/.exec(transform);
  if (match === null) throw new Error(`no matrix3d in ${transform}`);
  return match[1]!.split(',').map(Number);
}

function column(m: number[], i: number): [number, number, number] {
  return [m[i * 4]!, m[i * 4 + 1]!, m[i * 4 + 2]!];
}

function dot(p: number[], q: number[]): number {
  return p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
}

describe('d20 geometry', () => {
  it('has twenty faces numbered 1 to 20', () => {
    expect(D20_FACE_LIST.map((face) => face.value).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('places opposite faces so their values sum to 21', () => {
    const faces = D20_GEOMETRY.triangles();
    expect(faces).toHaveLength(20);
    for (const face of D20_FACE_LIST) {
      const normal = column(cells(face.placement), 2);
      const twin = D20_FACE_LIST.find((other) => {
        const n = column(cells(other.placement), 2);
        return (
          Math.abs(n[0] + normal[0]) < 1e-4 &&
          Math.abs(n[1] + normal[1]) < 1e-4 &&
          Math.abs(n[2] + normal[2]) < 1e-4
        );
      });
      expect(twin?.value).toBe(21 - face.value);
    }
  });

  it('places every face with an orthonormal right-handed frame pushed out by the inradius', () => {
    for (const face of D20_FACE_LIST) {
      const m = cells(face.placement);
      const [x, y, z] = [column(m, 0), column(m, 1), column(m, 2)];
      expect(dot(x, x)).toBeCloseTo(1, 4);
      expect(dot(y, y)).toBeCloseTo(1, 4);
      expect(dot(z, z)).toBeCloseTo(1, 4);
      expect(dot(x, y)).toBeCloseTo(0, 4);
      expect(dot(y, z)).toBeCloseTo(0, 4);
      expect(dot(x, z)).toBeCloseTo(0, 4);
      const handed = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      expect(dot(handed, z)).toBeCloseTo(1, 4);
      expect(face.placement).toContain(
        `translateZ(calc(var(--mtg-d20-edge) * ${String(D20_INRADIUS_PER_EDGE)}))`,
      );
    }
    const phi = (1 + Math.sqrt(5)) / 2;
    expect((phi * phi) / Math.sqrt(3) / D20_GEOMETRY.edge).toBeCloseTo(D20_INRADIUS_PER_EDGE, 4);
  });

  it('rests a face upright toward the viewer: rest times placement is the identity frame', () => {
    for (const face of D20_FACE_LIST) {
      const p = cells(face.placement);
      const r = cells(face.rest);
      const placed = [column(p, 0), column(p, 1), column(p, 2)];
      const rows = [
        [r[0]!, r[4]!, r[8]!],
        [r[1]!, r[5]!, r[9]!],
        [r[2]!, r[6]!, r[10]!],
      ];
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          expect(dot(rows[i]!, placed[j]!)).toBeCloseTo(i === j ? 1 : 0, 4);
        }
      }
    }
  });

  it('refuses a value no face reads', () => {
    expect(() => d20Face(21)).toThrow('no face reads 21');
    expect(d20Face(7).value).toBe(7);
  });
});
