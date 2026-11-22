/**
 * Inverse of the standard normal CDF by Acklam's rational approximation, whose
 * relative error stays below 1.15e-9 across (0, 1). A verdict interval needs no
 * more than that, and a refinement step would need an erfc this package lacks.
 */
const A = [
  -3.969_683_028_665_376e1, 2.209_460_984_245_205e2, -2.759_285_104_469_687e2, 1.383_577_518_672_69e2,
  -3.066_479_806_614_716e1, 2.506_628_277_459_239,
] as const;
const B = [
  -5.447_609_879_822_406e1, 1.615_858_368_580_409e2, -1.556_989_798_598_866e2, 6.680_131_188_771_972e1,
  -1.328_068_155_288_572e1,
] as const;
const C = [
  -7.784_894_002_430_293e-3, -3.223_964_580_411_365e-1, -2.400_758_277_161_838, -2.549_732_539_343_734,
  4.374_664_141_464_968, 2.938_163_982_698_783,
] as const;
const D = [
  7.784_695_709_041_462e-3, 3.224_671_290_700_398e-1, 2.445_134_137_142_996, 3.754_408_661_907_416,
] as const;
const LOW = 0.024_25;
const HIGH = 1 - LOW;

function tail(q: number): number {
  return (
    (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
    ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  );
}

/** The z at which the standard normal CDF equals `p`; refuses p outside the open unit interval. */
export function normalQuantile(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error('normal quantile needs a probability strictly inside (0, 1)');
  }
  if (p < LOW) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > HIGH) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}
