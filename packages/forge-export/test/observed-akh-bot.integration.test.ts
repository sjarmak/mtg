/** Real Forge AI outcomes, not a local policy standing in for the engine controller. */
import { expect, it } from 'vitest';
import type { ObservedSession, PendingDecision, SessionSpec } from '@mtg/engine';
import { snapshotForgeBackend } from './support/snapshot-backend';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
function localMove(
  decision: PendingDecision,
  name: string,
  keyword: string,
  canCast: boolean,
): string | undefined {
  if (decision.kind === 'priority') {
    return (
      decision.options.find((option) => option.text === 'Play Plains')?.id ??
      (canCast
        ? decision.options.find(
            (option) => option.text.startsWith(`${name}:`) && !option.text.includes(keyword),
          )?.id
        : undefined) ??
      decision.options.find((option) => option.text === 'Pass priority')?.id
    );
  }
  if (decision.kind === 'mana-payment')
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  if (decision.kind === 'combat-attackers')
    return (
      (keyword === 'Embalm'
        ? undefined
        : decision.options.find((option) => option.id.startsWith('combat-attack-add-'))?.id) ??
      decision.options.find((option) => option.id === 'combat-attackers-commit')?.id
    );
  if (decision.kind === 'combat-blockers')
    return (
      (keyword === 'Embalm'
        ? decision.options.find((option) => option.id.startsWith('combat-block-add-'))?.id
        : undefined) ?? decision.options.find((option) => option.id === 'combat-blockers-commit')?.id
    );
  if (decision.kind === 'discard-selection')
    return (
      decision.options.find((option) => option.targets.some((target) => target.name === name))?.id ??
      decision.options.find((option) => option.targets.some((target) => target.name === 'Plains'))?.id
    );
  return decision.options.find((option) => ['Play first', 'Keep this hand'].includes(option.text))?.id;
}

forgeIt.each([
  { name: 'Adorned Pouncer', keyword: 'Eternalize', power: 4, seed: 'akh-hou-pouncer-engine-v1' },
  { name: 'Sacred Cat', keyword: 'Embalm', power: 1, seed: 'akh-hou-sacred-cat-engine-v1' },
])(
  'Forge AI casts and loses $name, then uses $keyword in a real match',
  async ({ name, keyword, power, seed }) => {
    const deck = {
      name: 'graveyard-token-mirror',
      cards: [
        { name: 'Plains', count: 30 },
        { name, count: 30 },
      ],
    };
    const table: SessionSpec = {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { name: 'Local combat driver', controller: 'local', deck },
        { name: `Forge ${keyword} pilot`, controller: 'engine', deck },
      ],
      seed,
      maximumTurns: 40,
    };
    const backend = await snapshotForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    const seenOrdinary = new Set<string>();
    const seenGraveyard = new Set<string>();
    let tokenCreated = false;
    try {
      expect(await backend.supports(table)).toEqual([]);
      const opened = await backend.open(table);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let index = 0; index < 1800 && session.status === 'awaiting'; index += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Missing decision');
        expect(decision.seat).toBe(0);
        const bot = session.view.seats[1];
        expect(bot.hand).toBeNull();
        for (const card of bot.battlefield)
          if (card.name === name && !card.typeLine.includes('Zombie')) seenOrdinary.add(card.oid);
        for (const card of bot.graveyard) if (seenOrdinary.has(card.oid)) seenGraveyard.add(card.oid);
        const token = bot.battlefield.find((card) => card.name === name && card.typeLine.includes('Zombie'));
        if (token !== undefined) {
          expect(token).toMatchObject({ power, toughness: power });
          expect(token.typeLine).toContain('Zombie');
          expect(token.typeLine).toContain('Cat');
          expect(seenOrdinary.has(token.oid)).toBe(false);
          expect(bot.exile.some((card) => seenGraveyard.has(card.oid))).toBe(true);
          tokenCreated = true;
          break;
        }
        trace.push(
          `${session.view.turn.number}/${session.view.turn.step} ${decision.kind}: ${decision.options.map((option) => option.text).join(' | ')}`,
        );
        // Two defenders allow trades without an unbounded lifelink mirror.
        const canCast =
          keyword !== 'Embalm' ||
          session.view.seats[0].battlefield.filter((card) => card.name === name).length < 2;
        const move = localMove(decision, name, keyword, canCast);
        if (move === undefined) throw new Error(`Unhandled local decision\n${trace.slice(-8).join('\n')}`);
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-8).join('\n')}`);
        session = advanced.session;
      }
      expect(tokenCreated, trace.slice(-20).join('\n')).toBe(true);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  180_000,
);
