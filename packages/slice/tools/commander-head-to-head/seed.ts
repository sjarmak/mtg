import { createHash } from 'node:crypto';

export function pairingSeed(baseSeed: number, a: string, b: string, listedFirst: 'a' | 'b'): number {
  const digest = createHash('sha256')
    .update(`${String(baseSeed)}:${a}:${b}:${listedFirst}`)
    .digest();
  const masked = digest.readUInt32BE(0) & 0x7fffffff;
  return masked === 0 ? 1 : masked;
}
