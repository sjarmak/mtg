export interface CounterKind {
  readonly name: string;
  readonly stat: 'raises' | 'lowers' | 'mixed' | null;
}

const STAT_COUNTER = /^([PM])(\d+)([PM])(\d+)$/u;

function signed(side: string, amount: string): string {
  return `${side === 'P' ? '+' : '-'}${amount}`;
}

export function counterKind(kind: string): CounterKind {
  const stat = STAT_COUNTER.exec(kind);
  if (stat === null) return { name: kind.replaceAll('_', ' ').toLowerCase(), stat: null };
  const [, powerSide = '', power = '', toughnessSide = '', toughness = ''] = stat;
  return {
    name: `${signed(powerSide, power)}/${signed(toughnessSide, toughness)}`,
    stat: powerSide !== toughnessSide ? 'mixed' : powerSide === 'P' ? 'raises' : 'lowers',
  };
}
